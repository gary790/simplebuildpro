#!/usr/bin/env bash
# ============================================================
# SimpleBuild Pro — Secret Rotation Automation
# Rotates secrets in GCP Secret Manager and updates Cloud Run
# Phase 5.3c: Security & Compliance
# ============================================================
#
# Usage:
#   ./rotate-secrets.sh [secret-name]
#   ./rotate-secrets.sh --all
#   ./rotate-secrets.sh --list
#
# Prerequisites:
#   - gcloud CLI authenticated with appropriate permissions
#   - Access to simplebuildpro GCP project
#   - Secret Manager Admin role
#
# Schedule: Run monthly via Cloud Scheduler or cron
# ============================================================

set -euo pipefail

PROJECT_ID="simplebuildpro"
REGION="us-central1"
API_SERVICE="simplebuildpro-api"
LOG_FILE="/tmp/secret-rotation-$(date +%Y%m%d-%H%M%S).log"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# ─── Logging ─────────────────────────────────────────────────
log() { echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $*" | tee -a "$LOG_FILE"; }
warn() { echo -e "${YELLOW}[$(date +'%Y-%m-%d %H:%M:%S')] WARNING:${NC} $*" | tee -a "$LOG_FILE"; }
error() { echo -e "${RED}[$(date +'%Y-%m-%d %H:%M:%S')] ERROR:${NC} $*" | tee -a "$LOG_FILE"; }
info() { echo -e "${BLUE}[$(date +'%Y-%m-%d %H:%M:%S')] INFO:${NC} $*" | tee -a "$LOG_FILE"; }

# ─── Rotatable Secrets ───────────────────────────────────────
# Secrets that can be safely auto-rotated (generate new random values)
ROTATABLE_SECRETS=(
  "simplebuildpro-jwt-secret"
  "simplebuildpro-jwt-refresh-secret"
  "simplebuildpro-encryption-key"
)

# Secrets that require manual rotation (external service keys)
MANUAL_SECRETS=(
  "simplebuildpro-stripe-secret-key"
  "simplebuildpro-stripe-webhook-secret"
  "simplebuildpro-anthropic-api-key"
  "simplebuildpro-google-client-secret"
  "simplebuildpro-github-client-secret"
  "simplebuildpro-novita-api-key"
  "simplebuildpro-pagespeed-api-key"
  "simplebuildpro-e2b-api-key"
  "RESEND_API_KEY"
)

# ─── Helper Functions ────────────────────────────────────────
generate_secret() {
  local length=${1:-64}
  openssl rand -hex "$length"
}

generate_jwt_secret() {
  # JWT secrets need to be base64-encoded for jose library
  openssl rand -base64 48
}

generate_encryption_key() {
  # AES-256 requires exactly 32 bytes = 64 hex chars
  openssl rand -hex 32
}

get_secret_version_count() {
  local secret_name="$1"
  gcloud secrets versions list "$secret_name" \
    --project="$PROJECT_ID" \
    --format="value(name)" 2>/dev/null | wc -l
}

get_current_version() {
  local secret_name="$1"
  gcloud secrets versions list "$secret_name" \
    --project="$PROJECT_ID" \
    --filter="state=ENABLED" \
    --sort-by="~createTime" \
    --limit=1 \
    --format="value(name)" 2>/dev/null
}

add_secret_version() {
  local secret_name="$1"
  local new_value="$2"

  echo -n "$new_value" | gcloud secrets versions add "$secret_name" \
    --project="$PROJECT_ID" \
    --data-file=- 2>&1 | tee -a "$LOG_FILE"
}

disable_old_versions() {
  local secret_name="$1"
  local keep_count=${2:-2}  # Keep last N versions enabled

  local versions
  versions=$(gcloud secrets versions list "$secret_name" \
    --project="$PROJECT_ID" \
    --filter="state=ENABLED" \
    --sort-by="~createTime" \
    --format="value(name)")

  local count=0
  while IFS= read -r version; do
    count=$((count + 1))
    if [ "$count" -gt "$keep_count" ]; then
      log "  Disabling old version: $version"
      gcloud secrets versions disable "$version" \
        --secret="$secret_name" \
        --project="$PROJECT_ID" 2>&1 | tee -a "$LOG_FILE"
    fi
  done <<< "$versions"
}

# ─── Rotation Functions ──────────────────────────────────────
rotate_secret() {
  local secret_name="$1"
  log "Rotating: $secret_name"

  local new_value
  case "$secret_name" in
    *jwt-secret*|*jwt-refresh-secret*)
      new_value=$(generate_jwt_secret)
      ;;
    *encryption-key*)
      new_value=$(generate_encryption_key)
      ;;
    *)
      new_value=$(generate_secret 32)
      ;;
  esac

  # Add new version
  add_secret_version "$secret_name" "$new_value"
  if [ $? -eq 0 ]; then
    log "  ✅ New version added for $secret_name"
  else
    error "  ❌ Failed to add new version for $secret_name"
    return 1
  fi

  # Disable old versions (keep last 2)
  disable_old_versions "$secret_name" 2

  log "  ✅ Rotation complete for $secret_name"
}

redeploy_service() {
  log "Redeploying $API_SERVICE to pick up new secrets..."
  info "  (Cloud Run automatically uses 'latest' secret versions)"

  # Force a new revision to pick up secret changes
  gcloud run services update "$API_SERVICE" \
    --project="$PROJECT_ID" \
    --region="$REGION" \
    --no-traffic 2>&1 | tee -a "$LOG_FILE"

  # Verify health after redeploy
  sleep 10
  local health_url="https://api.simplebuildpro.com/health"
  local status
  status=$(curl -s -o /dev/null -w "%{http_code}" "$health_url" 2>/dev/null || echo "000")

  if [ "$status" = "200" ]; then
    log "  ✅ Service healthy after rotation (HTTP $status)"
  else
    warn "  ⚠️ Service may need attention (HTTP $status)"
    warn "  Check: gcloud run revisions list --service=$API_SERVICE --region=$REGION"
  fi
}

# ─── Commands ────────────────────────────────────────────────
list_secrets() {
  echo ""
  echo "═══════════════════════════════════════════════════════"
  echo " SimpleBuild Pro — Secret Inventory"
  echo "═══════════════════════════════════════════════════════"
  echo ""
  echo "Auto-Rotatable Secrets:"
  echo "───────────────────────"
  for secret in "${ROTATABLE_SECRETS[@]}"; do
    local versions
    versions=$(get_secret_version_count "$secret" 2>/dev/null || echo "?")
    local current
    current=$(get_current_version "$secret" 2>/dev/null || echo "?")
    printf "  %-40s versions: %-4s current: %s\n" "$secret" "$versions" "$current"
  done

  echo ""
  echo "Manual Rotation Required (external service keys):"
  echo "──────────────────────────────────────────────────"
  for secret in "${MANUAL_SECRETS[@]}"; do
    local versions
    versions=$(get_secret_version_count "$secret" 2>/dev/null || echo "?")
    printf "  %-40s versions: %s\n" "$secret" "$versions"
  done
  echo ""
}

rotate_all() {
  log "═══════════════════════════════════════════════════════"
  log " Starting full secret rotation"
  log "═══════════════════════════════════════════════════════"
  log ""

  local failed=0
  for secret in "${ROTATABLE_SECRETS[@]}"; do
    if ! rotate_secret "$secret"; then
      failed=$((failed + 1))
    fi
    echo ""
  done

  if [ "$failed" -eq 0 ]; then
    log "All secrets rotated successfully!"
    redeploy_service
  else
    error "$failed secret(s) failed to rotate. Check logs: $LOG_FILE"
    exit 1
  fi

  log ""
  log "═══════════════════════════════════════════════════════"
  log " Rotation complete. Log: $LOG_FILE"
  log "═══════════════════════════════════════════════════════"
}

rotate_single() {
  local target="$1"

  # Check if it's in the rotatable list
  local found=false
  for secret in "${ROTATABLE_SECRETS[@]}"; do
    if [ "$secret" = "$target" ]; then
      found=true
      break
    fi
  done

  if [ "$found" = false ]; then
    # Check if it's a manual secret
    for secret in "${MANUAL_SECRETS[@]}"; do
      if [ "$secret" = "$target" ]; then
        error "'$target' requires manual rotation (external service key)."
        error "Steps:"
        error "  1. Generate new key in the service's dashboard"
        error "  2. Run: echo -n 'NEW_KEY' | gcloud secrets versions add $target --data-file=- --project=$PROJECT_ID"
        error "  3. Redeploy: gcloud run services update $API_SERVICE --region=$REGION --project=$PROJECT_ID"
        exit 1
      fi
    done

    error "Unknown secret: $target"
    error "Run '$0 --list' to see available secrets."
    exit 1
  fi

  rotate_secret "$target"
  redeploy_service
}

# ─── Main ────────────────────────────────────────────────────
main() {
  if [ $# -eq 0 ]; then
    echo "Usage: $0 [--all | --list | <secret-name>]"
    echo ""
    echo "Options:"
    echo "  --all          Rotate all auto-rotatable secrets"
    echo "  --list         List all managed secrets"
    echo "  <secret-name>  Rotate a specific secret"
    echo ""
    echo "Examples:"
    echo "  $0 --list"
    echo "  $0 --all"
    echo "  $0 simplebuildpro-jwt-secret"
    exit 0
  fi

  case "$1" in
    --list|-l)
      list_secrets
      ;;
    --all|-a)
      echo ""
      warn "This will rotate ALL auto-rotatable secrets and redeploy the API."
      warn "Active user sessions will be invalidated (JWT secrets change)."
      echo ""
      read -p "Continue? [y/N] " confirm
      if [[ "$confirm" =~ ^[Yy]$ ]]; then
        rotate_all
      else
        echo "Aborted."
      fi
      ;;
    *)
      rotate_single "$1"
      ;;
  esac
}

main "$@"
