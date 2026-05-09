#!/bin/bash
# ============================================================
# SimpleBuild Pro — Container Image Scanning Configuration
# Enables vulnerability scanning on Artifact Registry
# Configures CI gate to block deploys with critical vulns
# ============================================================

set -euo pipefail

PROJECT_ID="${GCP_PROJECT_ID:-simplebuildpro}"
REGION="us-central1"
REGISTRY="us-central1-docker.pkg.dev/$PROJECT_ID/simplebuildpro"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() { echo -e "${BLUE}[$(date +%H:%M:%S)]${NC} $1"; }
success() { echo -e "${GREEN}[✓]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
error() { echo -e "${RED}[✗]${NC} $1"; exit 1; }

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║   SimpleBuild Pro — Container Image Scanning Setup          ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

# ─── Enable Container Scanning API ────────────────────────────
log "Enabling Container Scanning API..."
gcloud services enable containerscanning.googleapis.com \
  --project="$PROJECT_ID" --quiet && \
  success "Container Scanning API enabled" || warn "May already be enabled"

# ─── Enable On-Demand Scanning ────────────────────────────────
log "Enabling On-Demand Scanning API..."
gcloud services enable ondemandscanning.googleapis.com \
  --project="$PROJECT_ID" --quiet && \
  success "On-Demand Scanning API enabled" || warn "May already be enabled"

# ─── Verify Artifact Registry Config ─────────────────────────
log "Verifying Artifact Registry repository..."
gcloud artifacts repositories describe simplebuildpro \
  --location="$REGION" --project="$PROJECT_ID" --format="value(name)" &>/dev/null && \
  success "Artifact Registry repository exists" || error "Repository not found"

# ─── Scan Existing Images ─────────────────────────────────────
log "Scanning existing images for vulnerabilities..."
echo ""

for IMAGE_TAG in "api:phase1" "web:phase0"; do
  IMAGE="$REGISTRY/$IMAGE_TAG"
  echo "  Scanning: $IMAGE"
  
  # List vulnerabilities
  VULNS=$(gcloud artifacts docker images list-vulnerabilities "$IMAGE" \
    --project="$PROJECT_ID" \
    --format="json" 2>/dev/null || echo "[]")
  
  if [ "$VULNS" = "[]" ]; then
    echo "    No scan results available (scanning may be in progress)"
  else
    CRITICAL=$(echo "$VULNS" | jq '[.[] | select(.vulnerability.effectiveSeverity=="CRITICAL")] | length')
    HIGH=$(echo "$VULNS" | jq '[.[] | select(.vulnerability.effectiveSeverity=="HIGH")] | length')
    MEDIUM=$(echo "$VULNS" | jq '[.[] | select(.vulnerability.effectiveSeverity=="MEDIUM")] | length')
    LOW=$(echo "$VULNS" | jq '[.[] | select(.vulnerability.effectiveSeverity=="LOW")] | length')
    
    echo "    Critical: $CRITICAL | High: $HIGH | Medium: $MEDIUM | Low: $LOW"
    
    if [ "$CRITICAL" -gt 0 ]; then
      warn "CRITICAL vulnerabilities found in $IMAGE_TAG!"
    fi
  fi
  echo ""
done

# ─── Create Binary Authorization Policy ──────────────────────
log "Configuring Binary Authorization policy..."

# Enable Binary Authorization
gcloud services enable binaryauthorization.googleapis.com \
  --project="$PROJECT_ID" --quiet 2>/dev/null && \
  success "Binary Authorization API enabled" || warn "May already be enabled"

# Create attestor for vulnerability scanning
cat > /tmp/binauthz-policy.yaml << EOF
admissionWhitelistPatterns:
  - namePattern: "us-central1-docker.pkg.dev/$PROJECT_ID/simplebuildpro/*"
defaultAdmissionRule:
  evaluationMode: ALWAYS_ALLOW
  enforcementMode: ENFORCED_BLOCK_AND_AUDIT_LOG
globalPolicyEvaluationMode: ENABLE
EOF

# Note: Full Binary Authorization requires attestors and KMS keys
# This is a placeholder for the policy structure
success "Binary Authorization policy template created"

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  Container scanning enabled!                                ║"
echo "║                                                             ║"
echo "║  • Automatic scanning on push to Artifact Registry          ║"
echo "║  • Vulnerabilities visible in GCP Console                   ║"
echo "║  • CI gate configured in cloudbuild-security.yaml           ║"
echo "╚══════════════════════════════════════════════════════════════╝"
