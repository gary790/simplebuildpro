#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# SimpleBuild Pro - Database Migration Runner
# Runs SQL migrations against Cloud SQL (via proxy) or local PostgreSQL
# ─────────────────────────────────────────────────────────────────────────────

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
MIGRATIONS_DIR="$PROJECT_DIR/migrations"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}🗃️  SimpleBuild Pro - Database Migration Runner${NC}"
echo "───────────────────────────────────────────────────"

# Determine environment
ENV="${1:-local}"

case "$ENV" in
  local)
    DB_HOST="${DB_HOST:-localhost}"
    DB_PORT="${DB_PORT:-5432}"
    DB_USER="${DB_USER:-simplebuild}"
    DB_PASSWORD="${DB_PASSWORD:-localdev123}"
    DB_NAME="${DB_NAME:-simplebuildpro}"
    echo -e "Environment: ${YELLOW}LOCAL${NC}"
    ;;
  staging)
    DB_HOST="${DB_HOST:-127.0.0.1}"
    DB_PORT="${DB_PORT:-5432}"
    DB_USER="${DB_USER:?DB_USER is required for staging}"
    DB_PASSWORD="${DB_PASSWORD:?DB_PASSWORD is required for staging}"
    DB_NAME="${DB_NAME:-simplebuildpro_staging}"
    echo -e "Environment: ${YELLOW}STAGING${NC}"
    ;;
  production)
    DB_HOST="${DB_HOST:-127.0.0.1}"
    DB_PORT="${DB_PORT:-5432}"
    DB_USER="${DB_USER:?DB_USER is required for production}"
    DB_PASSWORD="${DB_PASSWORD:?DB_PASSWORD is required for production}"
    DB_NAME="${DB_NAME:-simplebuildpro}"
    echo -e "Environment: ${RED}PRODUCTION${NC}"
    echo ""
    read -p "⚠️  You are about to run migrations on PRODUCTION. Continue? (yes/no): " confirm
    if [ "$confirm" != "yes" ]; then
      echo "Aborted."
      exit 0
    fi
    ;;
  *)
    echo "Usage: $0 [local|staging|production]"
    exit 1
    ;;
esac

echo "  Host: $DB_HOST:$DB_PORT"
echo "  Database: $DB_NAME"
echo "  User: $DB_USER"
echo ""

# Check psql is available
if ! command -v psql &> /dev/null; then
  echo -e "${RED}❌ psql is not installed. Install postgresql-client.${NC}"
  exit 1
fi

# Test connection
echo "🔌 Testing database connection..."
if ! PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "SELECT 1" > /dev/null 2>&1; then
  echo -e "${RED}❌ Cannot connect to database. Check credentials and connectivity.${NC}"
  exit 1
fi
echo -e "${GREEN}  ✅ Connected${NC}"

# Create migrations tracking table
echo ""
echo "📋 Ensuring migrations tracking table exists..."
PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" <<EOF
CREATE TABLE IF NOT EXISTS _migrations (
  id SERIAL PRIMARY KEY,
  filename VARCHAR(255) UNIQUE NOT NULL,
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  checksum VARCHAR(64)
);
EOF

# Get applied migrations
APPLIED=$(PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -A -c "SELECT filename FROM _migrations ORDER BY filename")

# Run pending migrations
echo ""
echo "🔄 Checking for pending migrations..."

PENDING=0
APPLIED_COUNT=0
FAILED=0

for file in "$MIGRATIONS_DIR"/*.sql; do
  if [ ! -f "$file" ]; then
    echo "  No migration files found."
    break
  fi

  FILENAME=$(basename "$file")
  CHECKSUM=$(sha256sum "$file" | cut -d' ' -f1)

  if echo "$APPLIED" | grep -q "^${FILENAME}$"; then
    APPLIED_COUNT=$((APPLIED_COUNT + 1))
    continue
  fi

  PENDING=$((PENDING + 1))
  echo -e "  → Running: ${YELLOW}$FILENAME${NC}"

  if PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
    --set ON_ERROR_STOP=1 \
    -f "$file" 2>&1; then
    
    # Record successful migration
    PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c \
      "INSERT INTO _migrations (filename, checksum) VALUES ('$FILENAME', '$CHECKSUM')" > /dev/null 2>&1
    
    echo -e "    ${GREEN}✅ Applied${NC}"
  else
    FAILED=$((FAILED + 1))
    echo -e "    ${RED}❌ FAILED${NC}"
    echo -e "${RED}Migration failed. Stopping.${NC}"
    exit 1
  fi
done

# Summary
echo ""
echo "───────────────────────────────────────────────────"
echo -e "📊 Migration Summary:"
echo -e "  Previously applied: ${GREEN}$APPLIED_COUNT${NC}"
echo -e "  Newly applied:      ${GREEN}$PENDING${NC}"
if [ $FAILED -gt 0 ]; then
  echo -e "  Failed:             ${RED}$FAILED${NC}"
fi
echo -e "  Total migrations:   $((APPLIED_COUNT + PENDING))"
echo "───────────────────────────────────────────────────"
