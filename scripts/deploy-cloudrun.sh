#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# SimpleBuild Pro - Cloud Run Deployment Script
# Deploys API and Web services to Google Cloud Run
# ─────────────────────────────────────────────────────────────────────────────

set -e

# Configuration
PROJECT_ID="${GCP_PROJECT_ID:-simplebuildpro}"
REGION="${GCP_REGION:-us-central1}"
ARTIFACT_REGISTRY="$REGION-docker.pkg.dev/$PROJECT_ID/simplebuildpro"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}🚀 SimpleBuild Pro - Cloud Run Deployment${NC}"
echo "───────────────────────────────────────────────────"

# Parse arguments
SERVICE="${1:-all}"
TAG="${2:-latest}"

if [ "$TAG" == "latest" ]; then
  TAG=$(git rev-parse --short HEAD 2>/dev/null || echo "latest")
fi

echo -e "  Project:  ${YELLOW}$PROJECT_ID${NC}"
echo -e "  Region:   ${YELLOW}$REGION${NC}"
echo -e "  Service:  ${YELLOW}$SERVICE${NC}"
echo -e "  Tag:      ${YELLOW}$TAG${NC}"
echo ""

# Verify gcloud authentication
echo "🔐 Verifying GCP authentication..."
if ! gcloud auth print-identity-token > /dev/null 2>&1; then
  echo -e "${RED}❌ Not authenticated with GCP. Run: gcloud auth login${NC}"
  exit 1
fi
echo -e "${GREEN}  ✅ Authenticated${NC}"

# Verify project
gcloud config set project "$PROJECT_ID" --quiet

# Configure Docker
echo ""
echo "🐳 Configuring Docker for Artifact Registry..."
gcloud auth configure-docker "$REGION-docker.pkg.dev" --quiet

# Build and deploy function
deploy_service() {
  local SERVICE_NAME=$1
  local DOCKERFILE=$2
  local PORT=$3
  local MEMORY=$4
  local CPU=$5
  local MIN_INSTANCES=$6
  local MAX_INSTANCES=$7

  echo ""
  echo -e "${BLUE}━━━ Deploying: $SERVICE_NAME ━━━${NC}"

  # Build
  local IMAGE="$ARTIFACT_REGISTRY/$SERVICE_NAME:$TAG"
  echo "  📦 Building image: $IMAGE"
  docker build -f "$DOCKERFILE" -t "$IMAGE" .
  docker tag "$IMAGE" "$ARTIFACT_REGISTRY/$SERVICE_NAME:latest"

  # Push
  echo "  ⬆️  Pushing to Artifact Registry..."
  docker push "$IMAGE"
  docker push "$ARTIFACT_REGISTRY/$SERVICE_NAME:latest"

  # Deploy
  echo "  🚀 Deploying to Cloud Run..."
  gcloud run deploy "$SERVICE_NAME" \
    --image "$IMAGE" \
    --region "$REGION" \
    --platform managed \
    --allow-unauthenticated \
    --memory "$MEMORY" \
    --cpu "$CPU" \
    --min-instances "$MIN_INSTANCES" \
    --max-instances "$MAX_INSTANCES" \
    --concurrency 80 \
    --timeout 60s \
    --port "$PORT" \
    --set-env-vars "NODE_ENV=production" \
    --quiet

  # Get URL
  local URL=$(gcloud run services describe "$SERVICE_NAME" \
    --region "$REGION" \
    --format 'value(status.url)')

  echo -e "  ${GREEN}✅ Deployed: $URL${NC}"

  # Health check
  echo "  🔍 Running health check..."
  local HEALTH_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$URL/health" 2>/dev/null || echo "000")
  if [ "$HEALTH_STATUS" == "200" ]; then
    echo -e "  ${GREEN}✅ Health check passed${NC}"
  else
    echo -e "  ${YELLOW}⚠️  Health check returned: $HEALTH_STATUS${NC}"
  fi
}

# Deploy based on argument
case "$SERVICE" in
  api)
    deploy_service "simplebuildpro-api" "infra/docker/Dockerfile.api" 8080 "512Mi" 1 1 10
    ;;
  web)
    deploy_service "simplebuildpro-web" "infra/docker/Dockerfile.web" 3000 "512Mi" 1 1 5
    ;;
  all)
    deploy_service "simplebuildpro-api" "infra/docker/Dockerfile.api" 8080 "512Mi" 1 1 10
    deploy_service "simplebuildpro-web" "infra/docker/Dockerfile.web" 3000 "512Mi" 1 1 5
    ;;
  *)
    echo "Usage: $0 [api|web|all] [tag]"
    exit 1
    ;;
esac

echo ""
echo "───────────────────────────────────────────────────"
echo -e "${GREEN}✅ Deployment complete!${NC}"
echo ""

# Show service URLs
echo "📋 Service URLs:"
for svc in simplebuildpro-api simplebuildpro-web; do
  URL=$(gcloud run services describe "$svc" --region "$REGION" --format 'value(status.url)' 2>/dev/null || echo "not deployed")
  echo "  $svc: $URL"
done
echo "───────────────────────────────────────────────────"
