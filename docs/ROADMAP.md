# SimpleBuild Pro — Full Power-House Roadmap

## From MVP to Production-Grade Platform

**Document Created**: May 8, 2026  
**Current Status**: Phase 5.2/5.3 COMPLETE — All enterprise scale & security extensions deployed  
**GitHub**: https://github.com/gary790/simplebuildpro  
**Latest Deploy**: rev `simplebuildpro-api-00042-5cq` (May 9, 2026)

---

## Current State Summary

### ✅ What's Live & Working

- **API**: https://api.simplebuildpro.com (Cloud Run, 8 revisions deployed)
- **Web App**: https://app.simplebuildpro.com (Next.js on Cloud Run)
- **User Sites**: https://{slug}.sites.simplebuildpro.com (served via API → GCS)
- **CDN**: https://cdn.simplebuildpro.com (Cloud CDN + backend bucket)
- **Database**: Cloud SQL PostgreSQL 16 (18 tables, migrations applied)
- **Cache**: Memorystore Redis (10.1.204.211:6379)
- **SSL**: All certificates ACTIVE (api, app, cdn, sites, \*.sites)
- **OAuth**: GitHub + Google fully configured with production redirects
- **Billing**: PAYG metered billing system (routes + service + schema)
- **E2E Flow**: signup → project → file → build → deploy → serve site ✅

### ⚠️ Needs Attention

- Stripe keys still placeholder (need real Stripe account setup)
- Web frontend needs rebuild/redeploy (pricing page updated in code)
- Cloud SQL exposed to 0.0.0.0/0 (should be VPC-only)
- No CI/CD trigger (manual deploys only)
- No monitoring/alerting configured

---

## Phase 1: Stabilization & Security (Week 1)

### 1.1 Stripe Configuration

- [ ] Create Stripe account and get live API keys
- [ ] Update `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` in Secret Manager
- [ ] Create Stripe webhook endpoint pointing to `https://api.simplebuildpro.com/api/v1/billing/webhook`
- [ ] Subscribe to events: `setup_intent.succeeded`, `invoice.payment_succeeded`, `invoice.payment_failed`
- [ ] Test full payment flow: add card → usage → daily charge
- [ ] Set up Stripe Tax for automatic tax collection (optional)

### 1.2 Security Hardening

- [ ] **Restrict Cloud SQL to VPC-only** (remove 0.0.0.0/0 authorized network)
  ```bash
  gcloud sql instances patch simplebuildpro-db --authorized-networks="" --project=simplebuildpro
  ```
- [ ] Enable Cloud SQL IAM authentication (service account → DB)
- [ ] Rotate JWT_SECRET to a strong random value
- [ ] Enable Cloud Armor on the load balancer (DDoS protection, WAF rules)
- [ ] Add OWASP ModSecurity rules via Cloud Armor
- [ ] Implement CSRF tokens for state-changing requests
- [ ] Add Content-Security-Policy headers
- [ ] Enable VPC Service Controls (perimeter around GCS, SQL, Secrets)

### 1.3 Rebuild & Deploy Web Frontend

- [ ] Build Next.js web app with updated PAYG pricing page
- [ ] Push web image to Artifact Registry
- [ ] Deploy web Cloud Run service
- [ ] Verify landing page, signup, login, dashboard all work

### 1.4 Cloud Scheduler for Daily Billing

- [ ] Create Cloud Scheduler job:
  ```bash
  gcloud scheduler jobs create http daily-billing \
    --schedule="5 0 * * *" \
    --uri="https://api.simplebuildpro.com/api/v1/billing/internal/run-daily-billing" \
    --http-method=POST \
    --headers="x-internal-token=YOUR_JWT_SECRET,Content-Type=application/json" \
    --time-zone="UTC" \
    --project=simplebuildpro
  ```
- [ ] Test billing job manually via curl
- [ ] Monitor first automated run

---

## Phase 2: CI/CD & Monitoring (Week 2)

### 2.1 Cloud Build CI/CD Pipeline

- [ ] Create `cloudbuild.yaml` for automated deployments:
  ```yaml
  steps:
    # Build API
    - name: 'gcr.io/cloud-builders/docker'
      args: ['build', '-t', '${_API_IMAGE}', '-f', 'infra/docker/Dockerfile.api', '.']
    # Build Web
    - name: 'gcr.io/cloud-builders/docker'
      args: ['build', '-t', '${_WEB_IMAGE}', '-f', 'infra/docker/Dockerfile.web', '.']
    # Push images
    - name: 'gcr.io/cloud-builders/docker'
      args: ['push', '${_API_IMAGE}']
    - name: 'gcr.io/cloud-builders/docker'
      args: ['push', '${_WEB_IMAGE}']
    # Deploy API
    - name: 'gcr.io/google.com/cloudsdktool/cloud-sdk'
      args:
        [
          'gcloud',
          'run',
          'deploy',
          'simplebuildpro-api',
          '--image=${_API_IMAGE}',
          '--region=us-central1',
        ]
    # Deploy Web
    - name: 'gcr.io/google.com/cloudsdktool/cloud-sdk'
      args:
        [
          'gcloud',
          'run',
          'deploy',
          'simplebuildpro-web',
          '--image=${_WEB_IMAGE}',
          '--region=us-central1',
        ]
  substitutions:
    _API_IMAGE: us-central1-docker.pkg.dev/simplebuildpro/simplebuildpro/api:${SHORT_SHA}
    _WEB_IMAGE: us-central1-docker.pkg.dev/simplebuildpro/simplebuildpro/web:${SHORT_SHA}
  ```
- [ ] Connect Cloud Build to GitHub repository (push trigger on `main`)
- [ ] Add branch protection rules (require PR reviews)
- [ ] Add staging environment (deploy from `develop` branch)
- [ ] Tag releases with semantic versioning

### 2.2 Monitoring & Alerting

- [ ] **Cloud Monitoring Dashboard**:
  - Request latency (P50, P95, P99)
  - Error rate (5xx responses)
  - Cloud Run instance count & CPU usage
  - Cloud SQL connections & query latency
  - Redis hit rate & memory usage
- [ ] **Uptime Checks** (Cloud Monitoring):
  - https://api.simplebuildpro.com/health/live (every 60s)
  - https://app.simplebuildpro.com (every 60s)
  - https://my-first-website.sites.simplebuildpro.com (every 5m)
- [ ] **Alert Policies**:
  - 5xx error rate > 1% for 5 minutes → PagerDuty/Email
  - Latency P95 > 2s for 5 minutes → Email
  - Cloud SQL CPU > 80% for 10 minutes → Email
  - Cloud Run cold starts > 50/hour → Email
  - Daily billing job failure → Immediate alert
- [ ] **Cloud Error Reporting**: Already structured for it (JSON logs)
- [ ] **Cloud Trace**: Enable distributed tracing (already have request IDs)

### 2.3 Database Backups & DR

- [ ] Enable automated Cloud SQL backups:
  ```bash
  gcloud sql instances patch simplebuildpro-db \
    --backup-start-time=04:00 \
    --enable-bin-log \
    --project=simplebuildpro
  ```
- [ ] Enable point-in-time recovery (PITR)
- [ ] Set backup retention to 30 days
- [ ] Test restore procedure quarterly
- [ ] Set up cross-region replica (us-east1) for read scaling & DR

### 2.4 Logging & Audit

- [ ] Create log-based metrics for billing events
- [ ] Set up log exports to BigQuery for analytics
- [ ] Configure log retention (400 days for audit logs)
- [ ] Create Cloud Logging dashboard for real-time monitoring

---

## Phase 3: Feature Completion (Weeks 3-4)

### 3.1 Email System

- [ ] Integrate SendGrid or Resend for transactional email
- [ ] Email verification on signup (required before first deploy)
- [ ] Password reset flow (forgot password → email token → reset)
- [ ] Deploy notification emails (success/failure)
- [ ] Daily/weekly usage summary emails
- [ ] Spending alert emails (approaching limit)
- [ ] Welcome email series (onboarding)

### 3.2 Enhanced AI Features

- [ ] Stream AI responses (SSE/WebSocket via Cloud Run)
- [ ] AI context: include project file tree, recent changes
- [ ] AI templates: "Build me a landing page", "Add a contact form"
- [ ] AI code review on build
- [ ] Token usage display in real-time during chat
- [ ] Model selection (Claude Haiku for fast/cheap, Sonnet for quality)

### 3.3 Preview System Enhancement

- [ ] Preview hot-reload (push file changes to running sandbox)
- [ ] Preview URL sharing (public link for client review)
- [ ] Multi-device preview (desktop/tablet/mobile side-by-side)
- [ ] Preview session persistence (resume where you left off)
- [ ] Track preview_seconds in usage_logs for billing

### 3.4 Deploy & Hosting Improvements

- [ ] Custom domain SSL auto-provisioning (Let's Encrypt via Certificate Manager)
- [ ] Deploy rollback UI (one-click revert to previous version)
- [ ] Deploy previews (PR-style preview URLs before going live)
- [ ] CDN cache purge on deploy
- [ ] Bandwidth tracking per site (for billing)
- [ ] SPA routing support (fallback to index.html for client-side routers)
- [ ] Custom 404 pages
- [ ] Redirect rules configuration

### 3.5 Collaboration Features

- [ ] Real-time collaboration (Yjs/CRDT for concurrent editing)
- [ ] Comments on code/sections
- [ ] Activity feed per project
- [ ] Team billing (org-level payment method)
- [ ] Role-based access (viewer can preview, editor can edit, admin can deploy)

---

## Phase 4: Growth & Optimization (Weeks 5-8)

### 4.1 Performance Optimization

- [ ] Cloud Run min-instances: 1 (eliminate cold starts for $)
- [ ] Redis caching for:
  - Project file listings (invalidate on write)
  - User session data
  - Rate limit counters (already done)
  - Build artifacts metadata
- [ ] Image optimization Cloud Function (resize, WebP/AVIF conversion)
- [ ] Edge caching rules for static assets (1 year cache, versioned URLs)
- [ ] Database query optimization (add missing indexes, query plan review)
- [ ] Connection pooling via PgBouncer (if needed at scale)

### 4.2 Multi-Region Deployment

- [ ] Deploy API to us-east1 and europe-west1
- [ ] Global load balancer with latency-based routing (already have LB)
- [ ] Cloud SQL read replicas in each region
- [ ] GCS multi-region bucket for deploys (or regional with CDN)
- [ ] Redis instances per region (or Memorystore global)

### 4.3 Admin & Analytics

- [ ] Revenue dashboard (daily/monthly MRR, churn, ARPU)
- [ ] Usage analytics (most active users, popular features)
- [ ] Platform health dashboard (SLIs: availability, latency, error budget)
- [ ] User behavior analytics (funnel: signup → project → build → deploy)
- [ ] BigQuery data warehouse for long-term analytics
- [ ] Looker/Metabase dashboards

### 4.4 Developer Experience

- [ ] CLI tool (`simplebuild deploy`, `simplebuild init`)
- [ ] GitHub integration (import repos, deploy on push)
- [ ] Template marketplace (community templates)
- [ ] Plugin system (custom build steps)
- [ ] API documentation (OpenAPI/Swagger)
- [ ] Status page (status.simplebuildpro.com)

### 4.5 Billing Enhancements

- [ ] Prepaid credits (buy $50 credit, use until depleted)
- [ ] Volume discounts (usage > $100/mo → 10% off)
- [ ] Team billing (single invoice for org)
- [ ] Invoice PDF generation and email delivery
- [ ] Promo codes / referral credits
- [ ] Usage forecasting (predict next month's bill)

---

## Phase 5: Scale & Enterprise (Months 2-3) ✅ ALL COMPLETE

**Phase 5.1 Deployed**: May 9, 2026 — Cloud Run rev `simplebuildpro-api-00041-jsp`  
**Phase 5.2/5.3 Deployed**: May 9, 2026 — Cloud Run rev `simplebuildpro-api-00042-5cq`  
**Commit**: `f09cbec` — pushed to GitHub  
**Health**: DB 53ms, Redis 8ms, all systems healthy

### 5.1 Enterprise Features ✅

- [x] SSO (SAML 2.0 / OIDC) integration — `apps/api/src/routes/sso.ts`
  - SAML AuthnRequest/ACS + OIDC authorization code flow
  - Encrypted certificate/secret storage (AES-256-CBC)
  - Auto-provisioning, domain restrictions, org-level config
  - DB: `org_sso_configs` table with UNIQUE constraint per org
- [x] Custom branding (white-label option) — `apps/api/src/routes/branding.ts`
  - Logo, favicon, colors, custom CSS, footer, support contact
  - Enterprise plan: hide SimpleBuild branding
  - Public endpoint for login page rendering (`/branding/public/:orgSlug`)
  - DB: `org_branding` table
- [x] Dedicated infrastructure (isolated Cloud Run per enterprise) — `apps/api/src/routes/dedicated.ts`
  - Standard tier: isolated compute + DB schema + GCS bucket
  - Premium tier: dedicated Cloud SQL + Redis + enhanced resources
  - Full provisioning automation — `infra/dedicated/provision-dedicated.sh`
  - DB: `dedicated_environments` table (migration 0004 applied)
- [x] SLA guarantees (99.5%–99.99% by tier) — `docs/SLA_POLICY.md`
  - Tiered uptime commitments (Free → Enterprise Dedicated)
  - Credit calculation, escalation path, maintenance windows
  - Performance SLAs (API response times, build/deploy targets)
  - Support response times by severity and plan
- [x] SOC 2 Type II preparation — `docs/SOC2_PREPARATION.md`
  - Full TSC control mapping (Security, Availability, Confidentiality, Processing Integrity, Privacy)
  - ~68% ready score, target audit Q4 2026
  - Automated evidence collection — `infra/scripts/soc2-evidence-collector.sh`
  - Gap analysis with remediation timeline
- [x] Data residency options (EU/US) — `apps/api/src/middleware/data-residency.ts` + `routes/data-residency.ts`
  - Region detection (org setting → header → geo → default)
  - Strict enforcement mode (blocks cross-region transfers)
  - Regional DB/GCS/Redis routing configuration
  - EU-US Data Privacy Framework + SCC compliance
- [x] Audit log service — `apps/api/src/services/audit.ts`
  - Batched async writes (flush every 5s or 50 entries)
  - 40+ action types across auth, project, deploy, billing, org, admin, security
  - Severity inference (info/warning/critical)
  - Sync write for critical events, graceful shutdown
  - DB: `audit_logs` table with comprehensive indexes

### 5.2 Infrastructure Scaling ✅

- [x] GKE migration path — `docs/GKE_MIGRATION.md` + `infra/gke/`
  - GKE Autopilot cluster creation script (`create-cluster.sh`)
  - Helm chart: API deployment + HPA (3–50 pods) + PDB
  - Helm chart: WebSocket deployment with session affinity + BackendConfig
  - Helm chart: Ingress + ManagedCertificate + NetworkPolicy
  - Migration runbook: parallel deploy → traffic split → cutover → decommission
  - Cost comparison: Cloud Run vs GKE at scale
- [x] Database sharding strategy — `docs/DB_SHARDING_STRATEGY.md`
  - Shard key: `organization_id` (natural tenant isolation)
  - Shard router implementation design (cache + directory lookup)
  - Global tables (users, auth, billing) vs sharded tables (projects, files, assets)
  - Migration plan: single DB → sharded (3 phases, minimal downtime)
  - Cross-shard query patterns (fan-out, eventual consistency)
- [x] WebSocket support — `apps/api/src/services/websocket.ts`
  - Room-based pub/sub manager (project, file, build, notification rooms)
  - Live cursors, co-editing operations, build log streaming
  - Cloud Run WebSocket config (--timeout=3600, --session-affinity)
  - GKE BackendConfig for 1-hour WebSocket timeout
  - Stale connection cleanup, health endpoint, stats

### 5.3 Security & Compliance ✅

- [x] Penetration testing program — `docs/PENETRATION_TESTING.md`
  - Full OWASP Top 10 (2021) testing checklist
  - Automated scanning: OWASP ZAP baseline + Nuclei + Snyk
  - GitHub Actions workflow for weekly security scans
  - Vulnerability management process (CVSS-based SLAs)
  - Annual testing schedule with quarterly focus areas
- [x] Dependency scanning (Dependabot) — `.github/dependabot.yml`
  - Weekly scans: npm (root, api, web, db), Docker, GitHub Actions
  - Grouped updates, auto-PR with labels, reviewer assigned
- [x] Container image scanning — `infra/scripts/setup-container-scanning.sh` + `cloudbuild-security.yaml`
  - Artifact Registry automatic vulnerability scanning on push
  - Cloud Build security gate (blocks deploy on CRITICAL CVEs)
  - Binary Authorization policy template
  - On-demand scanning API enabled
- [x] Secret rotation automation — `infra/scripts/rotate-secrets.sh`
  - Auto-rotates JWT + encryption keys (monthly schedule)
  - Manual rotation guide for external API keys
  - Disables old versions, keeps last 2, redeploys service
- [x] Incident response playbook — `docs/INCIDENT_RESPONSE.md`
  - SEV-1 to SEV-4 classification with response times
  - Runbooks: API down, DB outage, security breach, Redis failure, billing, deploys
  - Communication templates, post-incident review process
  - Infrastructure reference table
- [x] GDPR data export/deletion tooling — `apps/api/src/routes/gdpr.ts`
  - Art. 15: Data summary (right of access)
  - Art. 17: Account deletion (right to erasure) with cascading delete + audit anonymization
  - Art. 20: Full data export as downloadable JSON (rate limited 1/24h)
  - Third-party processor disclosure, rights documentation
- [x] SOC 2 evidence collection automation — `infra/scripts/soc2-evidence-collector.sh`
  - Automated collection: IAM, firewall, encryption, monitoring, change management, backups
  - Monthly scheduled runs, organized output by control category
  - Summary report generation

---

## Infrastructure Cost Estimate (Monthly)

| Service           | Estimated Cost   | Notes                              |
| ----------------- | ---------------- | ---------------------------------- |
| Cloud Run (API)   | $30-100          | 2 min instances, autoscale to 10   |
| Cloud Run (Web)   | $20-50           | 1 min instance, autoscale to 5     |
| Cloud SQL         | $50-100          | db-f1-micro → db-g1-small at scale |
| Memorystore Redis | $35              | 1GB Basic tier                     |
| Cloud Storage     | $5-20            | Based on stored data               |
| Cloud CDN         | $10-50           | Based on egress                    |
| Load Balancer     | $18              | Global forwarding rule             |
| Secret Manager    | $1               | Per-access pricing                 |
| Cloud DNS         | $1               | Per zone + queries                 |
| Cloud Build       | $0-10            | 120 free min/day                   |
| Cloud Scheduler   | $0.10            | 3 free jobs                        |
| **Total**         | **~$170-385/mo** | Scales with usage                  |

**Break-even**: ~50-100 active paying users at avg $5/day spend.

---

## Immediate Action Items (Next 48 Hours)

1. **[YOU]** Create Stripe live account → provide keys
2. **[ME]** Set up Cloud Scheduler for daily billing job
3. **[ME]** Build and deploy web frontend (updated pricing page)
4. **[YOU]** Test signup flow end-to-end (create account, project, deploy)
5. **[ME]** Restrict Cloud SQL to VPC-only
6. **[ME]** Set up basic uptime monitoring + alert policies
7. **[ME]** Create Cloud Build trigger for CI/CD

---

## Key Metrics to Track

| Metric                | Target          | Current                     |
| --------------------- | --------------- | --------------------------- |
| API uptime            | 99.9%           | Unknown (no monitoring yet) |
| API P95 latency       | < 500ms         | ~200ms (health check)       |
| Signup → First Deploy | < 5 minutes     | Untested with real user     |
| Daily Active Users    | 10+ (Month 1)   | 1 (test)                    |
| Monthly Revenue       | $500+ (Month 2) | $0                          |
| Error rate            | < 0.1%          | ~0% (low traffic)           |
| Cold start time       | < 2s            | ~3-5s (needs min-instances) |

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    Internet / Users                          │
└─────────────┬───────────────────────────────────┬───────────┘
              │                                   │
    ┌─────────▼─────────┐              ┌─────────▼─────────┐
    │   Cloud DNS Zone   │              │  Certificate Mgr  │
    │  simplebuildpro.com│              │  (SSL wildcards)   │
    └─────────┬─────────┘              └─────────┬─────────┘
              │                                   │
    ┌─────────▼───────────────────────────────────▼─────────┐
    │              Global HTTPS Load Balancer                 │
    │              IP: 34.120.143.111                         │
    │  ┌──────────┬───────────┬──────────┬─────────────┐    │
    │  │ api.*    │ app/www/* │ cdn.*    │ *.sites.*   │    │
    │  └────┬─────┴─────┬─────┴────┬─────┴──────┬──────┘    │
    └───────┼───────────┼──────────┼────────────┼────────────┘
            │           │          │            │
    ┌───────▼──┐  ┌─────▼──┐  ┌───▼────┐  ┌───▼──────┐
    │Cloud Run │  │Cloud Run│  │Backend │  │Cloud Run │
    │  API     │  │  Web   │  │ Bucket │  │  API     │
    │(Hono/TS) │  │(Next.js)│  │(GCS CDN)│ │(sites.ts)│
    └────┬─────┘  └────────┘  └────────┘  └────┬─────┘
         │                                      │
    ┌────▼──────────────────────────────────────▼─────┐
    │                 VPC Network                       │
    │  ┌────────────┐  ┌──────────┐  ┌─────────────┐ │
    │  │ Cloud SQL  │  │  Redis   │  │ GCS Buckets │ │
    │  │ PostgreSQL │  │Memorystore│  │ assets/     │ │
    │  │ 18 tables  │  │          │  │ builds/     │ │
    │  │            │  │          │  │ deploys/    │ │
    │  │            │  │          │  │ snapshots/  │ │
    │  └────────────┘  └──────────┘  └─────────────┘ │
    └─────────────────────────────────────────────────┘
              │
    ┌─────────▼─────────┐
    │   External APIs    │
    │  • Anthropic Claude│
    │  • Stripe          │
    │  • Novita Sandbox  │
    │  • PageSpeed API   │
    └────────────────────┘
```

---

_This document is the single source of truth for SimpleBuild Pro's roadmap. Update as items are completed._
