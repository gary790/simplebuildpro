#!/bin/bash
# ============================================================
# SimpleBuild Pro — GKE Autopilot Cluster Setup
# Creates and configures the GKE Autopilot cluster
# ============================================================

set -euo pipefail

PROJECT_ID="${GCP_PROJECT_ID:-simplebuildpro}"
REGION="${GCP_REGION:-us-central1}"
CLUSTER_NAME="simplebuildpro-autopilot"
NETWORK="default"

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
echo "║      SimpleBuild Pro — GKE Autopilot Setup                  ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

# ─── Enable APIs ──────────────────────────────────────────────
log "Enabling required APIs..."
gcloud services enable \
  container.googleapis.com \
  containerregistry.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  --project="$PROJECT_ID" --quiet
success "APIs enabled"

# ─── Create Cluster ──────────────────────────────────────────
log "Creating GKE Autopilot cluster: $CLUSTER_NAME..."

if gcloud container clusters describe "$CLUSTER_NAME" --region="$REGION" --project="$PROJECT_ID" &>/dev/null; then
  warn "Cluster $CLUSTER_NAME already exists, skipping creation"
else
  gcloud container clusters create-auto "$CLUSTER_NAME" \
    --project="$PROJECT_ID" \
    --region="$REGION" \
    --network="$NETWORK" \
    --release-channel=regular \
    --enable-private-nodes \
    --master-ipv4-cidr=172.16.0.0/28 \
    --workload-pool="$PROJECT_ID.svc.id.goog" \
    --security-posture=standard \
    --workload-vulnerability-scanning=standard
  success "Cluster created"
fi

# ─── Configure kubectl ────────────────────────────────────────
log "Configuring kubectl credentials..."
gcloud container clusters get-credentials "$CLUSTER_NAME" \
  --region="$REGION" \
  --project="$PROJECT_ID"
success "kubectl configured"

# ─── Create Namespaces ────────────────────────────────────────
log "Creating namespaces..."
kubectl create namespace simplebuildpro --dry-run=client -o yaml | kubectl apply -f -
kubectl create namespace simplebuildpro-staging --dry-run=client -o yaml | kubectl apply -f -
kubectl create namespace monitoring --dry-run=client -o yaml | kubectl apply -f -
success "Namespaces created"

# ─── Workload Identity ────────────────────────────────────────
log "Setting up Workload Identity..."

# Create Kubernetes service account
kubectl create serviceaccount simplebuildpro-api \
  --namespace=simplebuildpro --dry-run=client -o yaml | kubectl apply -f -

# Bind GCP SA to K8s SA
gcloud iam service-accounts add-iam-policy-binding \
  "simplebuildpro-api@$PROJECT_ID.iam.gserviceaccount.com" \
  --role=roles/iam.workloadIdentityUser \
  --member="serviceAccount:$PROJECT_ID.svc.id.goog[simplebuildpro/simplebuildpro-api]" \
  --project="$PROJECT_ID" --quiet 2>/dev/null || warn "IAM binding may already exist"

kubectl annotate serviceaccount simplebuildpro-api \
  --namespace=simplebuildpro \
  --overwrite \
  "iam.gke.io/gcp-service-account=simplebuildpro-api@$PROJECT_ID.iam.gserviceaccount.com"

success "Workload Identity configured"

# ─── Secret Access ────────────────────────────────────────────
log "Granting Secret Manager access..."
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:simplebuildpro-api@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor" \
  --quiet 2>/dev/null || warn "Role may already be bound"
success "Secret Manager access granted"

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  GKE Autopilot cluster ready!                               ║"
echo "║  Cluster: $CLUSTER_NAME                        ║"
echo "║  Region:  $REGION                                   ║"
echo "║  Next: Deploy with Helm charts                              ║"
echo "╚══════════════════════════════════════════════════════════════╝"
