# SimpleBuild Pro — GKE Migration Guide

**Version**: 1.0  
**Target**: GKE Autopilot (us-central1)  
**Migration Type**: Cloud Run → GKE (gradual, traffic-split)

---

## 1. Architecture Overview

### Current (Cloud Run)
```
Load Balancer → Cloud Run (API, 1-10 instances)
             → Cloud Run (Web, 1-10 instances)
```

### Target (GKE Autopilot)
```
Load Balancer → GKE Autopilot Cluster
                ├── API Deployment (HPA: 3-50 pods)
                ├── Web Deployment (HPA: 3-20 pods)
                ├── WebSocket Deployment (HPA: 2-20 pods)
                ├── Worker Deployment (background jobs, 2-10 pods)
                └── Redis (Memorystore, sidecar for session affinity)
```

### When to Migrate

| Signal | Threshold | Action |
|--------|-----------|--------|
| Concurrent users | > 10,000 | Consider GKE |
| Cold start impact | > 5% of requests | Enable min-instances first |
| WebSocket needs | Real-time collaboration | GKE required |
| Cost efficiency | > $2,000/mo Cloud Run | GKE likely cheaper |
| Custom networking | Service mesh, mTLS | GKE required |
| Background jobs | > 30s processing | GKE workers |

---

## 2. Prerequisites

```bash
# Enable required APIs
gcloud services enable container.googleapis.com --project=simplebuildpro
gcloud services enable artifactregistry.googleapis.com --project=simplebuildpro
gcloud services enable secretmanager.googleapis.com --project=simplebuildpro

# Verify existing infrastructure
gcloud sql instances describe simplebuildpro-db --project=simplebuildpro
gcloud redis instances describe simplebuildpro-redis --region=us-central1 --project=simplebuildpro
```

---

## 3. GKE Cluster Creation

```bash
#!/bin/bash
# infra/gke/create-cluster.sh

PROJECT_ID="simplebuildpro"
REGION="us-central1"
CLUSTER_NAME="simplebuildpro-autopilot"
NETWORK="default"

# Create GKE Autopilot cluster
gcloud container clusters create-auto "$CLUSTER_NAME" \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --network="$NETWORK" \
  --release-channel=regular \
  --enable-private-nodes \
  --master-ipv4-cidr=172.16.0.0/28 \
  --enable-master-authorized-networks \
  --master-authorized-networks="34.120.143.111/32" \
  --workload-pool="$PROJECT_ID.svc.id.goog" \
  --security-posture=standard \
  --workload-vulnerability-scanning=standard

# Configure kubectl
gcloud container clusters get-credentials "$CLUSTER_NAME" \
  --region="$REGION" \
  --project="$PROJECT_ID"

# Create namespaces
kubectl create namespace simplebuildpro
kubectl create namespace simplebuildpro-staging
kubectl create namespace monitoring

# Enable Workload Identity
kubectl create serviceaccount simplebuildpro-api \
  --namespace=simplebuildpro

gcloud iam service-accounts add-iam-policy-binding \
  simplebuildpro-api@$PROJECT_ID.iam.gserviceaccount.com \
  --role=roles/iam.workloadIdentityUser \
  --member="serviceAccount:$PROJECT_ID.svc.id.goog[simplebuildpro/simplebuildpro-api]"

kubectl annotate serviceaccount simplebuildpro-api \
  --namespace=simplebuildpro \
  iam.gke.io/gcp-service-account=simplebuildpro-api@$PROJECT_ID.iam.gserviceaccount.com
```

---

## 4. Migration Runbook

### Phase 1: Parallel Deployment (Week 1-2)
1. Deploy to GKE alongside Cloud Run
2. Route 10% of traffic to GKE via load balancer weight
3. Monitor error rates, latency, resource usage
4. Increase to 25%, 50%, 75%, 100%

### Phase 2: Cutover (Week 3)
1. Route 100% traffic to GKE
2. Keep Cloud Run warm (min-instances=1) as fallback
3. Monitor for 72 hours

### Phase 3: Decommission (Week 4)
1. Scale Cloud Run to 0
2. Remove Cloud Run services
3. Update DNS/NEGs
4. Archive Cloud Run configs

### Rollback Plan
```bash
# Instant rollback: re-weight traffic to Cloud Run
gcloud compute backend-services update simplebuildpro-api-backend \
  --global \
  --backends="NEG=simplebuildpro-api-neg,balancingMode=UTILIZATION,maxUtilization=0.8,capacityScaler=1.0"
```

---

## 5. Cost Comparison

| Resource | Cloud Run (current) | GKE Autopilot (projected) |
|----------|--------------------|-----------------------|
| API compute | ~$150/mo (min-1, max-10) | ~$120/mo (3 pods e2-standard-2) |
| Web compute | ~$80/mo | ~$60/mo (3 pods e2-small) |
| WebSocket | N/A (not supported well) | ~$40/mo (2 pods) |
| Workers | N/A (no background jobs) | ~$30/mo (2 pods) |
| Cluster management | $0 | $0 (Autopilot — free) |
| Networking | ~$20/mo | ~$25/mo |
| **Total** | **~$250/mo** | **~$275/mo** |

**Note**: GKE becomes more cost-effective at scale (>20 pods). The primary driver for migration is capability (WebSockets, background jobs, service mesh) rather than cost.
