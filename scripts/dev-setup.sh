#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# SimpleBuild Pro - Local Development Setup
# ─────────────────────────────────────────────────────────────────────────────

set -e

echo "🚀 SimpleBuild Pro - Local Development Environment"
echo "───────────────────────────────────────────────────"

# Check Docker is running
if ! docker info > /dev/null 2>&1; then
  echo "❌ Docker is not running. Please start Docker Desktop first."
  exit 1
fi

# Create .env file if not exists
if [ ! -f .env ]; then
  echo "📝 Creating .env file from .env.example..."
  cp .env.example .env
  echo "⚠️  Please update .env with your actual API keys before starting services."
  echo ""
fi

# Parse arguments
PROFILE=""
if [ "$1" == "--tools" ]; then
  PROFILE="--profile tools"
  echo "🔧 Starting with admin tools (pgAdmin, Redis Commander)..."
fi

# Start services
echo ""
echo "🐳 Starting Docker services..."
docker compose up -d $PROFILE

# Wait for healthy services
echo ""
echo "⏳ Waiting for services to be healthy..."
sleep 5

# Check health
echo ""
echo "🔍 Checking service health..."

# Check PostgreSQL
if docker compose exec -T postgres pg_isready -U simplebuild > /dev/null 2>&1; then
  echo "  ✅ PostgreSQL is ready"
else
  echo "  ⏳ PostgreSQL is still starting..."
fi

# Check Redis
if docker compose exec -T redis redis-cli ping > /dev/null 2>&1; then
  echo "  ✅ Redis is ready"
else
  echo "  ⏳ Redis is still starting..."
fi

# Run migrations
echo ""
echo "🗃️  Running database migrations..."
for file in migrations/*.sql; do
  if [ -f "$file" ]; then
    echo "  → Running: $file"
    docker compose exec -T postgres psql -U simplebuild -d simplebuildpro -f "/docker-entrypoint-initdb.d/$(basename $file)" 2>/dev/null || true
  fi
done

echo ""
echo "───────────────────────────────────────────────────"
echo "✅ SimpleBuild Pro is running!"
echo ""
echo "  🌐 Web App:      http://localhost:3000"
echo "  🔌 API Server:   http://localhost:8080"
echo "  📊 API Health:   http://localhost:8080/health"
echo ""
if [ "$1" == "--tools" ]; then
  echo "  🗄️  pgAdmin:     http://localhost:5050"
  echo "     Email: admin@simplebuildpro.com / Pass: admin123"
  echo "  📦 Redis UI:    http://localhost:8081"
  echo ""
fi
echo "  📋 Useful commands:"
echo "     docker compose logs -f api     # API logs"
echo "     docker compose logs -f web     # Web logs"
echo "     docker compose down            # Stop all"
echo "     docker compose down -v         # Stop & remove data"
echo "───────────────────────────────────────────────────"
