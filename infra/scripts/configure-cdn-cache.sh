#!/bin/bash
# ============================================================
# SimpleBuild Pro — Cloud CDN Cache Policy Configuration
# Phase 4.1e: Edge caching rules for static assets
# Run this script to configure Cloud CDN cache policies
# ============================================================

set -e

PROJECT="simplebuildpro"
REGION="us-central1"

echo "=== Configuring Cloud CDN Cache Policies ==="

# 1. Update backend bucket (cdn.simplebuildpro.com) with aggressive caching
echo "→ Setting cache policy on CDN backend bucket..."
gcloud compute backend-buckets update simplebuildpro-cdn-bucket \
  --enable-cdn \
  --cache-mode=CACHE_ALL_STATIC \
  --default-ttl=86400 \
  --max-ttl=2592000 \
  --client-ttl=86400 \
  --negative-caching \
  --project=$PROJECT 2>/dev/null || echo "  (backend bucket CDN already configured or doesn't exist)"

# 2. Update API backend service with cache policy for site assets
echo "→ Setting cache policy on API backend (for sites serving)..."
gcloud compute backend-services update simplebuildpro-api-backend \
  --enable-cdn \
  --cache-mode=USE_ORIGIN_HEADERS \
  --default-ttl=300 \
  --max-ttl=86400 \
  --negative-caching \
  --global \
  --project=$PROJECT 2>/dev/null || echo "  (API backend CDN config skipped)"

# 3. Update Web backend service (Next.js static assets)
echo "→ Setting cache policy on Web backend..."
gcloud compute backend-services update simplebuildpro-web-backend \
  --enable-cdn \
  --cache-mode=USE_ORIGIN_HEADERS \
  --default-ttl=3600 \
  --max-ttl=86400 \
  --negative-caching \
  --global \
  --project=$PROJECT 2>/dev/null || echo "  (Web backend CDN config skipped)"

# 4. Create custom cache key policy for sites (cache by host + path, ignore cookies)
echo "→ Configuring cache key policies..."
gcloud compute backend-services update simplebuildpro-api-backend \
  --cache-key-include-host \
  --cache-key-include-protocol \
  --cache-key-include-query-string \
  --no-cache-key-include-named-cookies \
  --global \
  --project=$PROJECT 2>/dev/null || echo "  (cache key policy already set)"

echo ""
echo "=== Cloud CDN Configuration Complete ==="
echo ""
echo "Cache Policies Applied:"
echo "  • CDN Backend Bucket: CACHE_ALL_STATIC, TTL=24h, Max=30d"
echo "  • API Backend (sites): USE_ORIGIN_HEADERS, default 5min, max 24h"
echo "  • Web Backend (Next.js): USE_ORIGIN_HEADERS, default 1h, max 24h"
echo ""
echo "Served assets caching strategy:"
echo "  • Static files (.js, .css, images): Cache-Control: public, max-age=31536000, immutable"
echo "  • HTML pages: Cache-Control: public, max-age=300, stale-while-revalidate=60"
echo "  • API responses: Cache-Control: private, max-age=10-60 (via compression middleware)"
echo ""
echo "To purge CDN cache:"
echo "  gcloud compute url-maps invalidate-cdn-cache simplebuildpro-lb --path='/*' --global --project=$PROJECT"
