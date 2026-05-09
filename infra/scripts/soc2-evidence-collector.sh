#!/bin/bash
# ============================================================
# SimpleBuild Pro — SOC 2 Evidence Collector
# Automated evidence gathering for SOC 2 Type II audit
# Run monthly or before audit engagements
# ============================================================

set -euo pipefail

PROJECT_ID="${GCP_PROJECT_ID:-simplebuildpro}"
REGION="${GCP_REGION:-us-central1}"
OUTPUT_DIR="evidence/$(date +%Y-%m)"
TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() { echo -e "${BLUE}[$(date +%H:%M:%S)]${NC} $1"; }
success() { echo -e "${GREEN}[✓]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
error() { echo -e "${RED}[✗]${NC} $1"; }

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║      SimpleBuild Pro — SOC 2 Evidence Collector             ║"
echo "║      Timestamp: $TIMESTAMP              ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

mkdir -p "$OUTPUT_DIR"/{access-controls,network,encryption,monitoring,change-management,backup,vulnerability}

# ─── CC6.1 — Logical Access Controls ─────────────────────────
log "CC6.1: Collecting logical access controls..."

gcloud projects get-iam-policy "$PROJECT_ID" \
  --format=json > "$OUTPUT_DIR/access-controls/iam-policy.json" 2>/dev/null && \
  success "IAM policy exported" || warn "Failed to export IAM policy"

gcloud iam service-accounts list \
  --project="$PROJECT_ID" \
  --format=json > "$OUTPUT_DIR/access-controls/service-accounts.json" 2>/dev/null && \
  success "Service accounts listed" || warn "Failed to list service accounts"

# SA key audit (should be zero for good hygiene)
gcloud iam service-accounts list --project="$PROJECT_ID" --format="value(email)" 2>/dev/null | \
while read -r sa; do
  keys=$(gcloud iam service-accounts keys list --iam-account="$sa" \
    --managed-by=user --format="value(name)" 2>/dev/null | wc -l)
  if [ "$keys" -gt 0 ]; then
    warn "SA $sa has $keys user-managed keys (should be 0)"
  fi
done > "$OUTPUT_DIR/access-controls/sa-key-audit.txt" 2>&1
success "Service account key audit complete"

# ─── CC6.6 — Network Boundaries ──────────────────────────────
log "CC6.6: Collecting network boundary configuration..."

gcloud compute firewall-rules list \
  --project="$PROJECT_ID" \
  --format=json > "$OUTPUT_DIR/network/firewall-rules.json" 2>/dev/null && \
  success "Firewall rules exported" || warn "Failed to export firewall rules"

gcloud compute networks list \
  --project="$PROJECT_ID" \
  --format=json > "$OUTPUT_DIR/network/vpc-networks.json" 2>/dev/null && \
  success "VPC networks listed" || warn "Failed to list VPC networks"

gcloud compute networks subnets list \
  --project="$PROJECT_ID" \
  --format=json > "$OUTPUT_DIR/network/subnets.json" 2>/dev/null && \
  success "Subnets listed" || warn "Failed to list subnets"

# VPC connectors
gcloud compute networks vpc-access connectors list \
  --region="$REGION" --project="$PROJECT_ID" \
  --format=json > "$OUTPUT_DIR/network/vpc-connectors.json" 2>/dev/null && \
  success "VPC connectors listed" || warn "Failed to list VPC connectors"

# ─── CC6.7/6.8 — Encryption ──────────────────────────────────
log "CC6.7/6.8: Collecting encryption configuration..."

gcloud sql instances describe simplebuildpro-db \
  --project="$PROJECT_ID" \
  --format=json > "$OUTPUT_DIR/encryption/cloudsql-config.json" 2>/dev/null && \
  success "Cloud SQL config exported" || warn "Failed to export Cloud SQL config"

# Check SSL enforcement
gcloud sql instances describe simplebuildpro-db \
  --project="$PROJECT_ID" \
  --format="value(settings.ipConfiguration.requireSsl)" > "$OUTPUT_DIR/encryption/ssl-enforcement.txt" 2>/dev/null
success "SSL enforcement status captured"

# ─── CC7.1 — Vulnerability Management ────────────────────────
log "CC7.1: Collecting vulnerability scan results..."

# Container image vulnerabilities
gcloud artifacts docker images list \
  "us-central1-docker.pkg.dev/$PROJECT_ID/simplebuildpro" \
  --format=json > "$OUTPUT_DIR/vulnerability/container-images.json" 2>/dev/null && \
  success "Container images listed" || warn "Failed to list container images"

# Check if vulnerability scanning is enabled
gcloud services list --project="$PROJECT_ID" --filter="name:containerscanning.googleapis.com" \
  --format=json > "$OUTPUT_DIR/vulnerability/scanning-service-status.json" 2>/dev/null
success "Vulnerability scanning service status checked"

# ─── CC4.1 — Monitoring ──────────────────────────────────────
log "CC4.1: Collecting monitoring configuration..."

gcloud monitoring uptime list-configs \
  --project="$PROJECT_ID" \
  --format=json > "$OUTPUT_DIR/monitoring/uptime-checks.json" 2>/dev/null && \
  success "Uptime checks exported" || warn "Failed to export uptime checks"

gcloud monitoring alert-policies list \
  --project="$PROJECT_ID" \
  --format=json > "$OUTPUT_DIR/monitoring/alert-policies.json" 2>/dev/null && \
  success "Alert policies exported" || warn "Failed to export alert policies"

# Log sinks/exports
gcloud logging sinks list \
  --project="$PROJECT_ID" \
  --format=json > "$OUTPUT_DIR/monitoring/log-sinks.json" 2>/dev/null && \
  success "Log sinks exported" || warn "Failed to export log sinks"

# ─── CC8.1 — Change Management ───────────────────────────────
log "CC8.1: Collecting change management evidence..."

# Recent Cloud Run revisions
gcloud run revisions list \
  --service=simplebuildpro-api \
  --region="$REGION" \
  --project="$PROJECT_ID" \
  --format=json --limit=50 > "$OUTPUT_DIR/change-management/api-revisions.json" 2>/dev/null && \
  success "API revisions exported" || warn "Failed to export API revisions"

gcloud run revisions list \
  --service=simplebuildpro-web \
  --region="$REGION" \
  --project="$PROJECT_ID" \
  --format=json --limit=50 > "$OUTPUT_DIR/change-management/web-revisions.json" 2>/dev/null && \
  success "Web revisions exported" || warn "Failed to export web revisions"

# Recent Cloud Builds
gcloud builds list \
  --project="$PROJECT_ID" \
  --format=json --limit=50 > "$OUTPUT_DIR/change-management/cloud-builds.json" 2>/dev/null && \
  success "Cloud builds exported" || warn "Failed to export cloud builds"

# ─── CC7.4 — Backup & Recovery ───────────────────────────────
log "CC7.4: Collecting backup configuration..."

gcloud sql backups list \
  --instance=simplebuildpro-db \
  --project="$PROJECT_ID" \
  --format=json --limit=30 > "$OUTPUT_DIR/backup/db-backups.json" 2>/dev/null && \
  success "Database backups listed" || warn "Failed to list database backups"

# Backup policy
gcloud sql instances describe simplebuildpro-db \
  --project="$PROJECT_ID" \
  --format="json(settings.backupConfiguration)" > "$OUTPUT_DIR/backup/backup-policy.json" 2>/dev/null && \
  success "Backup policy exported" || warn "Failed to export backup policy"

# ─── Summary Report ──────────────────────────────────────────
log "Generating summary report..."

TOTAL_FILES=$(find "$OUTPUT_DIR" -type f | wc -l)
TOTAL_SIZE=$(du -sh "$OUTPUT_DIR" | cut -f1)

cat > "$OUTPUT_DIR/COLLECTION_SUMMARY.md" << EOF
# SOC 2 Evidence Collection Summary

**Collection Date**: $TIMESTAMP
**Project**: $PROJECT_ID
**Region**: $REGION

## Files Collected

| Category | Files |
|----------|-------|
| Access Controls | $(find "$OUTPUT_DIR/access-controls" -type f | wc -l) |
| Network | $(find "$OUTPUT_DIR/network" -type f | wc -l) |
| Encryption | $(find "$OUTPUT_DIR/encryption" -type f | wc -l) |
| Monitoring | $(find "$OUTPUT_DIR/monitoring" -type f | wc -l) |
| Change Management | $(find "$OUTPUT_DIR/change-management" -type f | wc -l) |
| Backup | $(find "$OUTPUT_DIR/backup" -type f | wc -l) |
| Vulnerability | $(find "$OUTPUT_DIR/vulnerability" -type f | wc -l) |

**Total Files**: $TOTAL_FILES
**Total Size**: $TOTAL_SIZE

## Next Steps
1. Review collected evidence for completeness
2. Upload to compliance platform (Vanta/Drata)
3. Flag any anomalies for investigation
4. Archive to secure storage (90-day retention minimum)
EOF

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  Collection Complete                                        ║"
echo "║  Total files: $TOTAL_FILES                                           ║"
echo "║  Total size:  $TOTAL_SIZE                                         ║"
echo "║  Output:      $OUTPUT_DIR                               ║"
echo "╚══════════════════════════════════════════════════════════════╝"
