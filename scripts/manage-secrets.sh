#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# SimpleBuild Pro - Secrets Management Script
# Populates Google Cloud Secret Manager with required secrets
# ─────────────────────────────────────────────────────────────────────────────

set -e

PROJECT_ID="${GCP_PROJECT_ID:-simplebuildpro}"
REGION="${GCP_REGION:-us-central1}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}🔐 SimpleBuild Pro - Secrets Manager${NC}"
echo "───────────────────────────────────────────────────"
echo -e "  Project: ${YELLOW}$PROJECT_ID${NC}"
echo ""

# Required secrets list
SECRETS=(
  "simplebuildpro-database-url"
  "simplebuildpro-redis-url"
  "simplebuildpro-jwt-secret"
  "simplebuildpro-jwt-refresh-secret"
  "simplebuildpro-google-client-id"
  "simplebuildpro-google-client-secret"
  "simplebuildpro-github-client-id"
  "simplebuildpro-github-client-secret"
  "simplebuildpro-stripe-secret-key"
  "simplebuildpro-stripe-webhook-secret"
  "simplebuildpro-anthropic-api-key"
  "simplebuildpro-gcs-bucket"
  "simplebuildpro-novita-api-key"
  "simplebuildpro-pagespeed-api-key"
)

# Function to create or update a secret
create_or_update_secret() {
  local SECRET_NAME=$1
  local SECRET_VALUE=$2

  # Check if secret exists
  if gcloud secrets describe "$SECRET_NAME" --project="$PROJECT_ID" > /dev/null 2>&1; then
    # Add new version
    echo "$SECRET_VALUE" | gcloud secrets versions add "$SECRET_NAME" \
      --project="$PROJECT_ID" \
      --data-file=- \
      --quiet
    echo -e "  ${GREEN}✅ Updated: $SECRET_NAME${NC}"
  else
    # Create secret
    echo "$SECRET_VALUE" | gcloud secrets create "$SECRET_NAME" \
      --project="$PROJECT_ID" \
      --data-file=- \
      --replication-policy="automatic" \
      --quiet
    echo -e "  ${GREEN}✅ Created: $SECRET_NAME${NC}"
  fi
}

# Parse command
CMD="${1:-status}"

case "$CMD" in
  status)
    echo "📋 Secret Status:"
    echo ""
    for secret in "${SECRETS[@]}"; do
      if gcloud secrets describe "$secret" --project="$PROJECT_ID" > /dev/null 2>&1; then
        VERSIONS=$(gcloud secrets versions list "$secret" --project="$PROJECT_ID" --format="value(name)" --limit=1 2>/dev/null)
        echo -e "  ${GREEN}✅${NC} $secret (v$VERSIONS)"
      else
        echo -e "  ${RED}❌${NC} $secret (not created)"
      fi
    done
    ;;

  init)
    echo "🔧 Initializing secrets (creating empty placeholders)..."
    echo ""
    for secret in "${SECRETS[@]}"; do
      if ! gcloud secrets describe "$secret" --project="$PROJECT_ID" > /dev/null 2>&1; then
        echo "PLACEHOLDER" | gcloud secrets create "$secret" \
          --project="$PROJECT_ID" \
          --data-file=- \
          --replication-policy="automatic" \
          --quiet
        echo -e "  ${YELLOW}📝 Created placeholder: $secret${NC}"
      else
        echo -e "  ${GREEN}✅ Already exists: $secret${NC}"
      fi
    done
    echo ""
    echo -e "${YELLOW}⚠️  Remember to update placeholder values with real secrets!${NC}"
    ;;

  set)
    SECRET_NAME="${2:?Secret name required}"
    echo -n "Enter value for $SECRET_NAME: "
    read -s SECRET_VALUE
    echo ""
    
    if [ -z "$SECRET_VALUE" ]; then
      echo -e "${RED}❌ Empty value not allowed${NC}"
      exit 1
    fi
    
    create_or_update_secret "$SECRET_NAME" "$SECRET_VALUE"
    ;;

  from-env)
    echo "📥 Populating secrets from .env file..."
    if [ ! -f .env ]; then
      echo -e "${RED}❌ .env file not found${NC}"
      exit 1
    fi

    # Map .env variables to secret names
    declare -A ENV_MAP=(
      ["DATABASE_URL"]="simplebuildpro-database-url"
      ["REDIS_URL"]="simplebuildpro-redis-url"
      ["JWT_SECRET"]="simplebuildpro-jwt-secret"
      ["JWT_REFRESH_SECRET"]="simplebuildpro-jwt-refresh-secret"
      ["GOOGLE_CLIENT_ID"]="simplebuildpro-google-client-id"
      ["GOOGLE_CLIENT_SECRET"]="simplebuildpro-google-client-secret"
      ["GITHUB_CLIENT_ID"]="simplebuildpro-github-client-id"
      ["GITHUB_CLIENT_SECRET"]="simplebuildpro-github-client-secret"
      ["STRIPE_SECRET_KEY"]="simplebuildpro-stripe-secret-key"
      ["STRIPE_WEBHOOK_SECRET"]="simplebuildpro-stripe-webhook-secret"
      ["ANTHROPIC_API_KEY"]="simplebuildpro-anthropic-api-key"
      ["GCS_BUCKET"]="simplebuildpro-gcs-bucket"
      ["NOVITA_API_KEY"]="simplebuildpro-novita-api-key"
      ["PAGESPEED_API_KEY"]="simplebuildpro-pagespeed-api-key"
    )

    while IFS='=' read -r key value; do
      # Skip comments and empty lines
      [[ "$key" =~ ^#.*$ ]] && continue
      [[ -z "$key" ]] && continue
      
      # Remove quotes from value
      value=$(echo "$value" | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//")
      
      if [ -n "${ENV_MAP[$key]}" ] && [ -n "$value" ]; then
        create_or_update_secret "${ENV_MAP[$key]}" "$value"
      fi
    done < .env
    ;;

  grant)
    SA="${2:?Service account email required}"
    echo "🔑 Granting secret access to: $SA"
    for secret in "${SECRETS[@]}"; do
      gcloud secrets add-iam-policy-binding "$secret" \
        --project="$PROJECT_ID" \
        --member="serviceAccount:$SA" \
        --role="roles/secretmanager.secretAccessor" \
        --quiet 2>/dev/null
      echo -e "  ${GREEN}✅${NC} $secret → $SA"
    done
    ;;

  *)
    echo "Usage: $0 [status|init|set <name>|from-env|grant <service-account>]"
    echo ""
    echo "Commands:"
    echo "  status    - Show which secrets exist"
    echo "  init      - Create placeholder secrets"
    echo "  set       - Set a specific secret value"
    echo "  from-env  - Populate from .env file"
    echo "  grant     - Grant access to a service account"
    exit 1
    ;;
esac

echo ""
echo "───────────────────────────────────────────────────"
