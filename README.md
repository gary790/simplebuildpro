# SimpleBuild Pro

**A full-stack website builder platform** — code editor, visual drag-and-drop builder, AI assistant, live preview, one-click deploy, team collaboration, and billing. Built for production deployment on Google Cloud Platform.

## Project Overview

- **Name**: SimpleBuild Pro
- **Stack**: Next.js 14 (frontend) + Hono (API) + PostgreSQL (Drizzle ORM) + GCP (Cloud Run, Cloud SQL, GCS, CDN)
- **Architecture**: Turborepo monorepo with shared packages
- **Lines of Code**: ~16,000+ across 100+ files

## Features

### Completed

- **Full IDE Editor** — Monaco-based code editor with file tree, tabs, terminal output, keyboard shortcuts (Cmd+S save, Cmd+B build)
- **Visual Website Builder** — Drag-and-drop component library (layouts, text, media, forms, interactive elements, navigation) with device preview (desktop/tablet/mobile), undo/redo, grid overlay, and Tailwind CSS integration
- **Code/Visual Mode Toggle** — Seamlessly switch between code editor and visual builder for HTML files
- **AI Chat Assistant** — Claude-powered AI chat integrated into the editor for code generation and assistance
- **Authentication** — Email/password signup & login with JWT access/refresh tokens, bcrypt password hashing
- **OAuth2 Login** — Google and GitHub OAuth2 with account linking, auto-registration, and secure callback handling
- **MFA/2FA (TOTP)** — Full two-factor authentication: QR code setup, TOTP verification, recovery codes, enable/disable flow with frontend UI in Settings
- **Project Management** — CRUD projects with slug-based routing, settings, and status tracking
- **File Management** — Create, edit, rename, delete files and folders; bulk upsert; content hashing
- **Asset Management** — Upload to GCS with CDN URLs, signed upload URLs, MIME type detection
- **Build System** — HTML/CSS/JS minification (html-minifier-terser, clean-css, terser), versioned snapshots stored in GCS
- **Deploy Pipeline** — One-click deploy to GCS with CDN distribution, version rollback support
- **Lighthouse Scoring** — Integrated into build step via PageSpeed Insights API with static-analysis fallback; scores performance, accessibility, best practices, SEO
- **Live Preview** — Novita sandbox-based live preview with real-time updates
- **Custom Domains** — Domain management with DNS verification and SSL certificate tracking
- **Billing & Subscriptions** — Stripe integration with checkout, portal, webhook handling; four plans (Free, Pro, Business, Enterprise)
- **Organizations & Teams** — Create orgs, manage members (owner/admin/editor/viewer roles), update roles, remove members
- **Invitation System** — Email-based org invitations with token-based acceptance, 7-day expiry, revocation
- **Admin Dashboard** — Platform overview (users, projects, deployments, orgs), user/project lists with pagination, plan distribution, AI usage metrics, system health monitoring
- **Rate Limiting** — Redis (Memorystore) backed sliding-window limiter with in-memory fallback; per-category limits (auth, API, AI, deploy, upload)
- **Structured Logging** — JSON structured logs for Cloud Logging with severity levels, request tracing, correlation IDs, audit logging
- **Request Tracing** — X-Request-ID propagation, response timing headers
- **Infrastructure as Code** — Full Terraform configuration for GCP: Cloud Run, Cloud SQL PostgreSQL 16, VPC, Secret Manager, GCS buckets, CDN, global load balancer, managed SSL, Artifact Registry
- **Database Migrations** — Versioned SQL migration files (0001_initial_schema, 0002_add_mfa_oauth_invitations)
- **CI/CD Pipeline** — GitHub Actions workflows: deploy.yml (build → test → migrate → deploy to Cloud Run with Workload Identity Federation), pr-checks.yml (lint, type check, tests, Docker build verification, security audit)
- **Docker Compose** — Full local development environment (PostgreSQL 16, Redis 7, API with hot-reload, Next.js dev server, optional pgAdmin + Redis Commander)
- **Cloud Run Configs** — Knative YAML service definitions for API and Web with startup/liveness/readiness probes, VPC connector, Cloud SQL integration
- **Deployment Scripts** — Automated scripts: deploy-cloudrun.sh (build + push + deploy), migrate.sh (migration runner with tracking), manage-secrets.sh (Secret Manager ops), cloud-sql.sh (instance create/backup/restore), gcp-setup.sh (full GCP project bootstrap)
- **Environment Configs** — Typed env validation (apps/api/src/config/), environment-specific CORS, rate-limit configs, .env templates for dev/staging/prod
- **Monitoring & APM** — Cloud Logging structured logs, W3C/Cloud Trace propagation, custom metrics reporter, error reporting (Cloud Error Reporting format), alert condition checks
- **Health Probes** — Cloud Run compatible: /health (detailed), /health/ready (readiness), /health/live (liveness), /health/startup (startup), /health/metrics (Prometheus-style)
- **Testing** — Playwright E2E tests (auth flows, editor, dashboard) + Vitest API integration tests (health, auth, projects, files, orgs, MFA, admin)

### Data Architecture

**Database**: Cloud SQL PostgreSQL 16 via Drizzle ORM

| Table | Description |
|---|---|
| `users` | User accounts with plan, MFA, OAuth fields |
| `oauth_accounts` | Google/GitHub OAuth linked accounts |
| `refresh_tokens` | JWT refresh token hashes with expiry/revocation |
| `organizations` | Teams with slug, owner, plan |
| `org_members` | Membership with role-based access |
| `org_invitations` | Pending invitations with token + expiry |
| `projects` | User projects with settings, status |
| `project_files` | File content with path, hash, MIME type |
| `project_assets` | Binary assets in GCS with CDN URLs |
| `project_versions` | Versioned snapshots for rollback |
| `deployments` | Deploy records with status, URLs, Lighthouse scores |
| `custom_domains` | Domain + SSL + DNS verification |
| `ai_conversations` | AI chat sessions per project |
| `ai_messages` | Individual chat messages with token tracking |
| `preview_sessions` | Novita sandbox sessions |
| `subscriptions` | Stripe subscription state |
| `usage_logs` | Metered usage (AI tokens, deploys, storage) |
| `audit_logs` | Security audit trail |

**Storage Services**: GCS buckets for assets, builds, deploys, snapshots; Redis (Memorystore) for rate limiting

## API Endpoints

### Authentication
| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/auth/signup` | Register new user |
| `POST` | `/api/v1/auth/login` | Email/password login |
| `POST` | `/api/v1/auth/refresh` | Refresh JWT tokens |
| `POST` | `/api/v1/auth/logout` | Revoke all tokens |
| `GET` | `/api/v1/auth/me` | Get current user profile |
| `PATCH` | `/api/v1/auth/me` | Update profile (name, avatar) |
| `POST` | `/api/v1/auth/change-password` | Change password |

### OAuth2
| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/oauth/google` | Redirect to Google OAuth |
| `GET` | `/api/v1/oauth/google/callback` | Google OAuth callback |
| `GET` | `/api/v1/oauth/github` | Redirect to GitHub OAuth |
| `GET` | `/api/v1/oauth/github/callback` | GitHub OAuth callback |

### MFA
| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/mfa/status` | Check MFA enabled/disabled |
| `POST` | `/api/v1/mfa/setup` | Generate TOTP secret + QR |
| `POST` | `/api/v1/mfa/verify-setup` | Verify code & enable MFA |
| `POST` | `/api/v1/mfa/verify` | Verify MFA during login |
| `POST` | `/api/v1/mfa/disable` | Disable MFA (requires password) |

### Projects
| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/projects` | List user projects |
| `POST` | `/api/v1/projects` | Create project |
| `GET` | `/api/v1/projects/:id` | Get project details |
| `PATCH` | `/api/v1/projects/:id` | Update project |
| `DELETE` | `/api/v1/projects/:id` | Delete project |

### Files & Assets
| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/files?projectId=` | List project files |
| `POST` | `/api/v1/files` | Upsert file |
| `POST` | `/api/v1/files/bulk-upsert` | Bulk upsert files |
| `DELETE` | `/api/v1/files` | Delete file |
| `POST` | `/api/v1/files/rename` | Rename file |
| `GET` | `/api/v1/assets?projectId=` | List assets |
| `POST` | `/api/v1/assets/upload` | Upload asset |
| `DELETE` | `/api/v1/assets/:id` | Delete asset |

### Build & Deploy
| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/build` | Build project (minify + snapshot) |
| `GET` | `/api/v1/build/versions?projectId=` | List versions |
| `POST` | `/api/v1/build/restore` | Restore version |
| `POST` | `/api/v1/deploy` | Deploy to CDN |
| `GET` | `/api/v1/deploy?projectId=` | List deployments |
| `POST` | `/api/v1/deploy/rollback` | Rollback deployment |

### Organizations
| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/organizations` | Create organization |
| `GET` | `/api/v1/organizations/:id` | Get org details |
| `GET` | `/api/v1/organizations/:id/members` | List members |
| `PATCH` | `/api/v1/organizations/:id/members/:mid` | Update member role |
| `DELETE` | `/api/v1/organizations/:id/members/:mid` | Remove member |
| `POST` | `/api/v1/organizations/:id/invitations` | Send invitation |
| `GET` | `/api/v1/organizations/:id/invitations` | List pending invitations |
| `DELETE` | `/api/v1/organizations/:id/invitations/:iid` | Revoke invitation |
| `POST` | `/api/v1/organizations/invitations/:token/accept` | Accept invitation |

### Admin (Business/Enterprise only)
| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/admin/overview` | Dashboard stats |
| `GET` | `/api/v1/admin/users` | Paginated user list |
| `GET` | `/api/v1/admin/projects` | Paginated project list |
| `GET` | `/api/v1/admin/deployments` | Recent deployments |
| `GET` | `/api/v1/admin/audit-logs` | Audit log entries |
| `GET` | `/api/v1/admin/health` | System health check |

### Other
| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/ai/message` | Send AI chat message |
| `GET` | `/api/v1/ai/conversations` | List conversations |
| `POST` | `/api/v1/preview/start` | Start preview sandbox |
| `POST` | `/api/v1/billing/checkout` | Create Stripe checkout |
| `GET` | `/api/v1/billing/subscription` | Get subscription |
| `GET` | `/health` | Health check |

## Project Structure

```
simplebuildpro/
├── apps/
│   ├── api/                          # Hono API server
│   │   ├── src/
│   │   │   ├── index.ts              # Server entry + route registration
│   │   │   ├── routes/
│   │   │   │   ├── auth.ts           # Signup, login, refresh, profile
│   │   │   │   ├── oauth.ts          # Google & GitHub OAuth2
│   │   │   │   ├── mfa.ts            # TOTP 2FA setup/verify/disable
│   │   │   │   ├── projects.ts       # Project CRUD
│   │   │   │   ├── files.ts          # File management
│   │   │   │   ├── assets.ts         # Asset upload/management
│   │   │   │   ├── ai.ts             # AI chat (Claude)
│   │   │   │   ├── preview.ts        # Novita sandbox preview
│   │   │   │   ├── build.ts          # Build + minification
│   │   │   │   ├── deploy.ts         # Deploy to GCS/CDN
│   │   │   │   ├── billing.ts        # Stripe billing
│   │   │   │   ├── organizations.ts  # Org CRUD + invitations
│   │   │   │   ├── admin.ts          # Admin dashboard API
│   │   │   │   └── health.ts         # Health check
│   │   │   ├── middleware/
│   │   │   │   ├── auth.ts           # JWT authentication
│   │   │   │   ├── rate-limiter.ts   # Redis + memory rate limiter
│   │   │   │   ├── request-logger.ts # Structured request logging
│   │   │   │   └── error-handler.ts  # Global error handler
│   │   │   └── services/
│   │   │       ├── logger.ts         # Structured JSON logger
│   │   │       ├── lighthouse.ts     # Lighthouse scoring service
│   │   │       ├── storage.ts        # GCS storage service
│   │   │       └── novita.ts         # Novita sandbox service
│   │   └── package.json
│   │
│   └── web/                          # Next.js 14 frontend
│       └── app/
│           ├── (auth)/
│           │   ├── login/page.tsx     # Login with OAuth buttons
│           │   └── signup/page.tsx    # Registration
│           ├── auth/callback/page.tsx # OAuth callback handler
│           ├── (dashboard)/
│           │   └── dashboard/
│           │       ├── page.tsx       # Project dashboard
│           │       ├── settings/page.tsx # Profile, billing, security + MFA
│           │       └── admin/page.tsx # Admin dashboard
│           ├── editor/[projectId]/page.tsx # Full IDE workspace
│           ├── invite/[token]/page.tsx     # Invitation acceptance
│           ├── components/
│           │   ├── editor/
│           │   │   ├── code-editor.tsx      # Monaco editor
│           │   │   ├── website-builder.tsx   # Visual drag-and-drop builder
│           │   │   ├── file-tree.tsx         # File explorer
│           │   │   ├── tab-bar.tsx           # Editor tabs
│           │   │   ├── preview-panel.tsx     # Live preview
│           │   │   └── ai-chat.tsx           # AI chat panel
│           │   └── ui/                       # Reusable UI components
│           └── lib/
│               ├── api-client.ts    # API client with auto-refresh
│               └── store.ts         # Zustand global stores
│
├── packages/
│   ├── db/                           # Database package
│   │   └── src/
│   │       ├── schema.ts            # Drizzle ORM schema (18 tables)
│   │       ├── client.ts            # Database client
│   │       └── index.ts             # Exports
│   └── shared/                       # Shared package
│       └── src/
│           ├── types.ts             # TypeScript type contracts
│           ├── constants.ts         # App constants, plan limits
│           ├── validation.ts        # Zod validation schemas
│           └── templates.ts         # Project templates
│
├── migrations/
│   ├── 0001_initial_schema.sql      # Core tables, enums, indexes
│   └── 0002_add_mfa_oauth_invitations.sql  # MFA + OAuth additions
│
├── tests/
│   ├── e2e/
│   │   ├── playwright.config.ts     # Playwright configuration
│   │   ├── auth.spec.ts             # Auth E2E tests
│   │   └── editor.spec.ts           # Editor E2E tests
│   └── api/
│       ├── vitest.config.ts         # Vitest configuration
│       ├── health.test.ts           # Health/core API tests
│       ├── auth.test.ts             # Auth API tests
│       └── projects.test.ts         # Projects/orgs/MFA API tests
│
├── infra/
│   └── terraform/
│       ├── main.tf                  # Full GCP infrastructure
│       ├── terraform.tfvars.example # Variable template
│       └── .gitignore               # Terraform state exclusions
│
├── .github/workflows/
│   ├── deploy.yml               # CI/CD: build, test, migrate, deploy to Cloud Run
│   └── pr-checks.yml            # PR: lint, type check, tests, Docker build, security scan
│
├── infra/
│   ├── terraform/
│   │   ├── main.tf              # Full GCP infrastructure
│   │   ├── terraform.tfvars.example
│   │   └── .gitignore
│   ├── cloudrun/
│   │   ├── api-service.yaml     # Cloud Run API service spec (Knative)
│   │   ├── web-service.yaml     # Cloud Run Web service spec (Knative)
│   │   └── services.ts          # Service config definitions
│   └── docker/
│       ├── Dockerfile.api       # Multi-stage API image
│       └── Dockerfile.web       # Multi-stage Next.js image
│
├── scripts/
│   ├── gcp-setup.sh             # One-time GCP project bootstrap
│   ├── deploy-cloudrun.sh       # Build & deploy to Cloud Run
│   ├── migrate.sh               # DB migration runner (local/staging/prod)
│   ├── manage-secrets.sh        # Secret Manager operations
│   ├── cloud-sql.sh             # Cloud SQL create/backup/restore
│   └── dev-setup.sh             # Docker Compose local dev startup
│
├── docker-compose.yml               # Local dev: Postgres + Redis + API + Web
├── .env.example                      # Dev environment template
├── .env.production.example           # Production environment template
├── .env.staging.example              # Staging environment template
├── turbo.json                        # Turborepo configuration
├── package.json                      # Root workspace config
└── tsconfig.json                     # Root TypeScript config
```

## Getting Started

### Prerequisites

- Node.js >= 20
- npm >= 10
- PostgreSQL 16 (or use Docker)
- Google Cloud SDK (for deployment)
- Terraform >= 1.5 (for infrastructure)

### Local Development (Docker Compose — Recommended)

```bash
# 1. Clone the repository
git clone https://github.com/gary790/simplebuildpro.git
cd simplebuildpro

# 2. Install dependencies
npm install

# 3. Set up environment variables
cp .env.example .env
# Fill in API keys (OAuth, Stripe, Anthropic, etc.)

# 4. Start all services (Postgres, Redis, API, Web)
./scripts/dev-setup.sh
# Or manually: docker compose up -d

# 5. Services are available at:
#    Web:   http://localhost:3000
#    API:   http://localhost:8080
#    Health: http://localhost:8080/health

# Optional: Start with admin tools (pgAdmin, Redis Commander)
./scripts/dev-setup.sh --tools
```

### Local Development (Manual)

```bash
# 1. Clone and install
git clone https://github.com/gary790/simplebuildpro.git
cd simplebuildpro && npm install

# 2. Set up environment variables
cp .env.example .env

# 3. Run database migrations
./scripts/migrate.sh local

# 4. Start development servers
npm run dev
# API: http://localhost:8080
# Web: http://localhost:3000
```

### Environment Variables (API)

```env
# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/simplebuildpro

# JWT
JWT_SECRET=your-64-char-random-secret
JWT_ACCESS_EXPIRY=15m
JWT_REFRESH_EXPIRY=30d

# Google OAuth
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret

# GitHub OAuth
GITHUB_CLIENT_ID=your-github-client-id
GITHUB_CLIENT_SECRET=your-github-client-secret

# Redis (Memorystore)
REDIS_URL=redis://localhost:6379

# Stripe
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Anthropic (AI)
ANTHROPIC_API_KEY=sk-ant-...

# Google Cloud
GCP_PROJECT_ID=simplebuildpro
GCS_ASSETS_BUCKET=simplebuildpro-assets
GCS_BUILDS_BUCKET=simplebuildpro-builds
GCS_DEPLOYS_BUCKET=simplebuildpro-deploys

# Novita (Preview Sandbox)
NOVITA_API_KEY=your-novita-key

# PageSpeed Insights
PAGESPEED_API_KEY=your-pagespeed-key

# App URLs
API_URL=http://localhost:8080
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_API_URL=http://localhost:8080
```

### Running Tests

```bash
# API integration tests (requires running API server)
npm run test:api

# E2E tests (requires running API + Web servers)
npm run test:e2e

# E2E tests with UI
npm run test:e2e:ui
```

## Deployment

### GCP Infrastructure (Terraform)

```bash
cd infra/terraform

# 1. Copy and fill in variables
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars with your GCP project details

# 2. Initialize Terraform
terraform init

# 3. Plan and review
terraform plan

# 4. Apply infrastructure
terraform apply

# 5. Note the outputs: api_url, web_url, lb_ip
```

### Deploy Application

```bash
# Option 1: Automated (GitHub Actions — pushes to main auto-deploy)
git push origin main

# Option 2: Manual deployment script
./scripts/deploy-cloudrun.sh all          # Deploy both API + Web
./scripts/deploy-cloudrun.sh api          # Deploy API only
./scripts/deploy-cloudrun.sh web          # Deploy Web only

# Option 3: Docker + gcloud manual
npm run docker:api
npm run docker:web
docker tag simplebuildpro-api us-central1-docker.pkg.dev/simplebuildpro/simplebuildpro/api:latest
docker push us-central1-docker.pkg.dev/simplebuildpro/simplebuildpro/api:latest
docker tag simplebuildpro-web us-central1-docker.pkg.dev/simplebuildpro/simplebuildpro/web:latest
docker push us-central1-docker.pkg.dev/simplebuildpro/simplebuildpro/web:latest
```

### Database Migrations (Production)

```bash
# Run migrations via Cloud SQL Proxy
./scripts/migrate.sh production

# Or via CI/CD (automatic on push to main)
```

### Secrets Management

```bash
# Check status of all secrets
./scripts/manage-secrets.sh status

# Initialize placeholder secrets
./scripts/manage-secrets.sh init

# Populate from .env file
./scripts/manage-secrets.sh from-env

# Set individual secret
./scripts/manage-secrets.sh set simplebuildpro-jwt-secret

# Grant access to service account
./scripts/manage-secrets.sh grant simplebuildpro-api@simplebuildpro.iam.gserviceaccount.com
```

### Cloud SQL Operations

```bash
./scripts/cloud-sql.sh create    # Create instance
./scripts/cloud-sql.sh backup    # Manual backup
./scripts/cloud-sql.sh backups   # List backups
./scripts/cloud-sql.sh connect   # Start SQL Proxy
./scripts/cloud-sql.sh status    # Instance status
```

### DNS Setup

Point your domain's DNS to the load balancer IP:
```
simplebuildpro.com      A     <lb_ip>
www.simplebuildpro.com  A     <lb_ip>
api.simplebuildpro.com  A     <lb_ip>
```

SSL certificates are auto-provisioned by Google-managed certificates.

## Plan Limits

| Feature | Free | Pro ($19/mo) | Business ($49/mo) | Enterprise |
|---|---|---|---|---|
| Projects | 3 | 25 | Unlimited | Unlimited |
| AI Messages/mo | 50 | 500 | 2,000 | Unlimited |
| Storage | 100 MB | 5 GB | 25 GB | 500 GB |
| Deploys/mo | 10 | Unlimited | Unlimited | Unlimited |
| Custom Domains | 0 | 3 | 10 | Unlimited |
| Collaborators | 0 | 5 | 25 | Unlimited |
| MFA | Yes | Yes | Yes | Yes |
| Admin Dashboard | No | No | Yes | Yes |

## Security

- **Password hashing**: bcrypt with cost factor 12
- **JWT tokens**: Short-lived access tokens (15 min) + long-lived refresh tokens (30 days)
- **Refresh token rotation**: Old tokens revoked on refresh
- **MFA/TOTP**: RFC 6238 compliant with recovery codes (SHA-256 hashed)
- **OAuth2**: Secure state parameter, PKCE-ready
- **Rate limiting**: Redis-backed sliding window with per-category limits
- **CORS**: Strict origin whitelist
- **Security headers**: X-Content-Type-Options, X-Frame-Options, etc.
- **Audit logging**: All sensitive actions logged with user, IP, user-agent
- **Secret management**: GCP Secret Manager for production secrets

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14, React 18, Tailwind CSS, Zustand, Lucide Icons |
| API | Hono, Node.js 20, TypeScript |
| Database | PostgreSQL 16, Drizzle ORM |
| Auth | JWT (jsonwebtoken), bcryptjs, TOTP |
| AI | Anthropic Claude (claude-sonnet-4-20250514) |
| Storage | Google Cloud Storage |
| Preview | Novita Sandbox |
| Billing | Stripe |
| Rate Limiting | Redis (GCP Memorystore) |
| Build Tools | html-minifier-terser, clean-css, terser, sharp |
| Infrastructure | GCP Cloud Run, Cloud SQL, Cloud CDN, Terraform |
| CI/CD | GitHub Actions |
| Testing | Playwright (E2E), Vitest (API) |
| Monorepo | Turborepo |

## URLs

- **GitHub**: https://github.com/gary790/simplebuildpro
- **Production API**: https://api.simplebuildpro.com
- **Production Web**: https://app.simplebuildpro.com
- **Cloud Run API**: https://simplebuildpro-api-397170798284.us-central1.run.app
- **Cloud Run Web**: https://simplebuildpro-web-397170798284.us-central1.run.app
- **Load Balancer IP**: 34.120.143.111

## Deployment Status

- **Platform**: Google Cloud (Cloud Run + Cloud SQL + Memorystore Redis + Load Balancer)
- **Region**: us-central1
- **Status**: ✅ Deployed and running
- **Last Updated**: May 7, 2026

### Infrastructure Components

| Component | Resource | Status |
|---|---|---|
| **API Server** | Cloud Run `simplebuildpro-api` | ✅ Running |
| **Web Frontend** | Cloud Run `simplebuildpro-web` | ✅ Running |
| **Database** | Cloud SQL PostgreSQL 16 `simplebuildpro-db` (136.113.45.130) | ✅ RUNNABLE |
| **Cache** | Memorystore Redis `simplebuildpro-redis` (10.1.204.211:6379) | ✅ READY |
| **VPC Connector** | `sbpro-vpc-connector` (10.8.0.0/28) | ✅ READY |
| **Load Balancer** | Global HTTPS LB (34.120.143.111) | ✅ Active |
| **SSL Certificate** | Google-managed for api/app.simplebuildpro.com | ⏳ Pending DNS |
| **Artifact Registry** | `us-central1-docker.pkg.dev/simplebuildpro/simplebuildpro` | ✅ Ready |
| **Secret Manager** | DATABASE_URL, REDIS_URL | ✅ Configured |

### DNS Configuration Required

To complete the deployment, add these DNS A records at your domain registrar:

```
api.simplebuildpro.com    A    34.120.143.111
app.simplebuildpro.com    A    34.120.143.111
simplebuildpro.com        A    34.120.143.111
www.simplebuildpro.com    A    34.120.143.111
```

Once DNS propagates, the Google-managed SSL certificate will auto-provision (typically 10-30 minutes after DNS is set).

### Redeployment

```bash
# Rebuild and push Docker images
gcloud builds submit --config=cloudbuild.yaml --project=simplebuildpro

# Deploy API
gcloud run deploy simplebuildpro-api \
  --image=us-central1-docker.pkg.dev/simplebuildpro/simplebuildpro/api:latest \
  --region=us-central1 --project=simplebuildpro

# Deploy Web
gcloud run deploy simplebuildpro-web \
  --image=us-central1-docker.pkg.dev/simplebuildpro/simplebuildpro/web:latest \
  --region=us-central1 --project=simplebuildpro
```

## License

Proprietary. All rights reserved.
