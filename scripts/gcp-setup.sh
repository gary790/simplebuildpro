#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# SimpleBuild Pro — GCP Initial Setup Script
# Run once to set up the GCP project infrastructure
# ─────────────────────────────────────────────────────────────────────────────

set -e

PROJECT_ID="${GCP_PROJECT_ID:-simplebuildpro}"
REGION="${GCP_REGION:-us-central1}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}🏗️  SimpleBuild Pro — GCP Project Setup${NC}"
echo "───────────────────────────────────────────────────"
echo -e "  Project: ${YELLOW}$PROJECT_ID${NC}"
echo -e "  Region:  ${YELLOW}$REGION${NC}"
echo ""

# 1. Enable required APIs
echo -e "${BLUE}1/8${NC} Enabling GCP APIs..."
APIS=(
  "run.googleapis.com"
  "sqladmin.googleapis.com"
  "secretmanager.googleapis.com"
  "artifactregistry.googleapis.com"
  "redis.googleapis.com"
  "vpcaccess.googleapis.com"
  "compute.googleapis.com"
  "cloudresourcemanager.googleapis.com"
  "iam.googleapis.com"
  "servicenetworking.googleapis.com"
  "cloudbuild.googleapis.com"
)

for api in "${APIS[@]}"; do
  gcloud services enable "$api" --project="$PROJECT_ID" --quiet 2>/dev/null && \
    echo -e "  ${GREEN}✅${NC} $api" || \
    echo -e "  ${YELLOW}⚠️${NC} $api (may already be enabled)"
done

# 2. Create Artifact Registry
echo ""
echo -e "${BLUE}2/8${NC} Creating Artifact Registry..."
gcloud artifacts repositories create simplebuildpro \
  --repository-format=docker \
  --location="$REGION" \
  --project="$PROJECT_ID" \
  --description="SimpleBuild Pro Docker images" \
  --quiet 2>/dev/null && \
  echo -e "  ${GREEN}✅ Created${NC}" || \
  echo -e "  ${YELLOW}⚠️  Already exists${NC}"

# 3. Create VPC Connector (for Cloud Run → Cloud SQL/Redis private access)
echo ""
echo -e "${BLUE}3/8${NC} Creating Serverless VPC Connector..."
gcloud compute networks vpc-access connectors create simplebuildpro-vpc-connector \
  --region="$REGION" \
  --project="$PROJECT_ID" \
  --network=default \
  --range=10.8.0.0/28 \
  --min-instances=2 \
  --max-instances=3 \
  --quiet 2>/dev/null && \
  echo -e "  ${GREEN}✅ Created${NC}" || \
  echo -e "  ${YELLOW}⚠️  Already exists${NC}"

# 4. Create Service Accounts
echo ""
echo -e "${BLUE}4/8${NC} Creating Service Accounts..."

# API Service Account
gcloud iam service-accounts create simplebuildpro-api \
  --display-name="SimpleBuild Pro API" \
  --project="$PROJECT_ID" \
  --quiet 2>/dev/null && \
  echo -e "  ${GREEN}✅ simplebuildpro-api${NC}" || \
  echo -e "  ${YELLOW}⚠️  simplebuildpro-api already exists${NC}"

# Web Service Account
gcloud iam service-accounts create simplebuildpro-web \
  --display-name="SimpleBuild Pro Web" \
  --project="$PROJECT_ID" \
  --quiet 2>/dev/null && \
  echo -e "  ${GREEN}✅ simplebuildpro-web${NC}" || \
  echo -e "  ${YELLOW}⚠️  simplebuildpro-web already exists${NC}"

# GitHub Actions Service Account (for CI/CD)
gcloud iam service-accounts create github-actions \
  --display-name="GitHub Actions CI/CD" \
  --project="$PROJECT_ID" \
  --quiet 2>/dev/null && \
  echo -e "  ${GREEN}✅ github-actions${NC}" || \
  echo -e "  ${YELLOW}⚠️  github-actions already exists${NC}"

# 5. Grant IAM roles
echo ""
echo -e "${BLUE}5/8${NC} Granting IAM roles..."

API_SA="simplebuildpro-api@${PROJECT_ID}.iam.gserviceaccount.com"
WEB_SA="simplebuildpro-web@${PROJECT_ID}.iam.gserviceaccount.com"
GHA_SA="github-actions@${PROJECT_ID}.iam.gserviceaccount.com"

# API Service Account roles
ROLES_API=(
  "roles/secretmanager.secretAccessor"
  "roles/cloudsql.client"
  "roles/storage.objectAdmin"
  "roles/run.invoker"
)

for role in "${ROLES_API[@]}"; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:$API_SA" \
    --role="$role" \
    --quiet > /dev/null 2>&1
done
echo -e "  ${GREEN}✅ API SA: ${#ROLES_API[@]} roles granted${NC}"

# GitHub Actions SA roles
ROLES_GHA=(
  "roles/run.admin"
  "roles/iam.serviceAccountUser"
  "roles/artifactregistry.writer"
  "roles/secretmanager.secretAccessor"
  "roles/cloudsql.client"
)

for role in "${ROLES_GHA[@]}"; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:$GHA_SA" \
    --role="$role" \
    --quiet > /dev/null 2>&1
done
echo -e "  ${GREEN}✅ GitHub Actions SA: ${#ROLES_GHA[@]} roles granted${NC}"

# 6. Create Redis Instance (Memorystore)
echo ""
echo -e "${BLUE}6/8${NC} Creating Redis (Memorystore) instance..."
gcloud redis instances create simplebuildpro-redis \
  --size=1 \
  --region="$REGION" \
  --project="$PROJECT_ID" \
  --redis-version=redis_7_0 \
  --tier=BASIC \
  --quiet 2>/dev/null && \
  echo -e "  ${GREEN}✅ Created (this may take a few minutes)${NC}" || \
  echo -e "  ${YELLOW}⚠️  Already exists${NC}"

# 7. Create GCS Bucket
echo ""
echo -e "${BLUE}7/8${NC} Creating GCS Storage Bucket..."
gsutil mb -p "$PROJECT_ID" -l "$REGION" -c STANDARD \
  "gs://simplebuildpro-assets" 2>/dev/null && \
  echo -e "  ${GREEN}✅ Created${NC}" || \
  echo -e "  ${YELLOW}⚠️  Already exists${NC}"

# Enable versioning
gsutil versioning set on "gs://simplebuildpro-assets" 2>/dev/null

# Set CORS
cat > /tmp/cors.json << 'EOF'
[
  {
    "origin": ["https://app.simplebuildpro.com", "https://api.simplebuildpro.com"],
    "method": ["GET", "PUT", "POST", "DELETE"],
    "responseHeader": ["Content-Type", "Authorization"],
    "maxAgeSeconds": 3600
  }
]
EOF
gsutil cors set /tmp/cors.json "gs://simplebuildpro-assets" 2>/dev/null

# 8. Setup Workload Identity Federation (for GitHub Actions)
echo ""
echo -e "${BLUE}8/8${NC} Setting up Workload Identity Federation..."

POOL_NAME="github-pool"
PROVIDER_NAME="github-provider"

gcloud iam workload-identity-pools create "$POOL_NAME" \
  --project="$PROJECT_ID" \
  --location="global" \
  --display-name="GitHub Actions Pool" \
  --quiet 2>/dev/null && \
  echo -e "  ${GREEN}✅ Pool created${NC}" || \
  echo -e "  ${YELLOW}⚠️  Pool already exists${NC}"

gcloud iam workload-identity-pools providers create-oidc "$PROVIDER_NAME" \
  --project="$PROJECT_ID" \
  --location="global" \
  --workload-identity-pool="$POOL_NAME" \
  --display-name="GitHub Provider" \
  --attribute-mapping="google.subject=assertion.sub,attribute.actor=assertion.actor,attribute.repository=assertion.repository" \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --quiet 2>/dev/null && \
  echo -e "  ${GREEN}✅ Provider created${NC}" || \
  echo -e "  ${YELLOW}⚠️  Provider already exists${NC}"

# Bind GHA SA to workload identity
POOL_ID=$(gcloud iam workload-identity-pools describe "$POOL_NAME" \
  --project="$PROJECT_ID" \
  --location="global" \
  --format="value(name)" 2>/dev/null || echo "")

if [ -n "$POOL_ID" ]; then
  gcloud iam service-accounts add-iam-policy-binding "$GHA_SA" \
    --project="$PROJECT_ID" \
    --role="roles/iam.workloadIdentityUser" \
    --member="principalSet://iam.googleapis.com/${POOL_ID}/attribute.repository/gary790/simplebuildpro" \
    --quiet 2>/dev/null
  echo -e "  ${GREEN}✅ Workload Identity bound to GitHub repo${NC}"
fi

# Summary
echo ""
echo "───────────────────────────────────────────────────"
echo -e "${GREEN}✅ GCP Setup Complete!${NC}"
echo ""
echo "📋 Next Steps:"
echo "  1. Create Cloud SQL: ./scripts/cloud-sql.sh create"
echo "  2. Populate secrets: ./scripts/manage-secrets.sh from-env"
echo "  3. Build & deploy:   ./scripts/deploy-cloudrun.sh all"
echo ""
echo "🔑 GitHub Actions Secrets to add:"
echo "  GCP_WORKLOAD_IDENTITY_PROVIDER:"
WIF_PROVIDER=$(gcloud iam workload-identity-pools providers describe "$PROVIDER_NAME" \
  --project="$PROJECT_ID" \
  --location="global" \
  --workload-identity-pool="$POOL_NAME" \
  --format="value(name)" 2>/dev/null || echo "  (run again after pool is ready)")
echo "    $WIF_PROVIDER"
echo "  GCP_SERVICE_ACCOUNT: $GHA_SA"
echo "  CLOUD_SQL_CONNECTION_NAME: ${PROJECT_ID}:${REGION}:simplebuildpro-db"
echo "───────────────────────────────────────────────────"
