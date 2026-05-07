# SimpleBuild Pro

**Enterprise Website Builder** — Build, preview, and deploy production websites at scale.

**Domain**: [simplebuildpro.com](https://simplebuildpro.com)  
**API**: [api.simplebuildpro.com](https://api.simplebuildpro.com)  
**GitHub**: [gary790/simplebuildpro](https://github.com/gary790/simplebuildpro)

---

## Overview

SimpleBuild Pro is a full-stack SaaS website builder featuring a browser-based IDE with Monaco code editor, Claude-powered AI assistant, isolated live preview via Novita sandbox, one-click deploy to global CDN, Stripe billing, and team collaboration — all hosted on Google Cloud.

## Architecture

```
simplebuildpro/                     # Turborepo monorepo
├── apps/
│   ├── api/                        # Hono REST API (Cloud Run, port 8080)
│   │   ├── src/
│   │   │   ├── index.ts            # Server entry — middleware + route registration
│   │   │   ├── routes/
│   │   │   │   ├── health.ts       # /health — DB connectivity check
│   │   │   │   ├── auth.ts         # /api/v1/auth — signup, login, refresh, logout, profile
│   │   │   │   ├── projects.ts     # /api/v1/projects — CRUD, templates, pagination
│   │   │   │   ├── files.ts        # /api/v1/files — upsert, bulk, rename, delete
│   │   │   │   ├── assets.ts       # /api/v1/assets — upload, signed URL, GCS CDN
│   │   │   │   ├── ai.ts           # /api/v1/ai — Claude chat + SSE streaming
│   │   │   │   ├── preview.ts      # /api/v1/preview — Novita sandbox lifecycle
│   │   │   │   ├── build.ts        # /api/v1/build — minify, snapshot, version
│   │   │   │   ├── deploy.ts       # /api/v1/deploy — GCS deploy, custom domains, rollback
│   │   │   │   └── billing.ts      # /api/v1/billing — Stripe checkout, portal, webhooks
│   │   │   ├── middleware/
│   │   │   │   ├── auth.ts         # JWT verification, session injection
│   │   │   │   ├── error-handler.ts# AppError class, Zod + generic error handling
│   │   │   │   └── rate-limiter.ts # Sliding-window rate limiter per category
│   │   │   └── services/
│   │   │       ├── storage.ts      # Google Cloud Storage wrapper (upload, signed URLs, batch)
│   │   │       └── novita.ts       # Novita sandbox SDK (create, update, kill, logs)
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── web/                        # Next.js 15 frontend (Cloud Run, port 3000)
│       ├── app/
│       │   ├── layout.tsx          # Root layout — AuthProvider + ToastContainer
│       │   ├── page.tsx            # Landing page — hero, features, pricing, CTA
│       │   ├── globals.css         # Tailwind + editor layout + custom scrollbars
│       │   ├── (auth)/
│       │   │   ├── login/page.tsx  # Login form with JWT token management
│       │   │   └── signup/page.tsx # Signup with plan selection
│       │   ├── (dashboard)/
│       │   │   └── dashboard/
│       │   │       ├── page.tsx    # Project grid/list, usage cards, create modal
│       │   │       └── settings/page.tsx  # Profile, billing (Stripe), security tabs
│       │   ├── editor/
│       │   │   └── [projectId]/page.tsx   # Full IDE workspace
│       │   ├── components/
│       │   │   ├── auth-provider.tsx       # Session restore, route protection
│       │   │   ├── ui/
│       │   │   │   ├── button.tsx          # Variant/size system, loading state
│       │   │   │   ├── modal.tsx           # Animated overlay + ESC dismiss
│       │   │   │   ├── toast.tsx           # Zustand-backed notification system
│       │   │   │   └── dropdown.tsx        # Click-outside menu
│       │   │   └── editor/
│       │   │       ├── file-tree.tsx       # Hierarchical file browser
│       │   │       ├── code-editor.tsx     # Monaco wrapper (custom theme, shortcuts)
│       │   │       ├── tab-bar.tsx         # Open file tabs with dirty indicators
│       │   │       ├── preview-panel.tsx   # Novita iframe, device toggle, controls
│       │   │       └── ai-chat.tsx         # Claude streaming chat, file-update parser
│       │   └── lib/
│       │       ├── api-client.ts   # Typed fetch wrapper, auto-refresh, SSE streaming
│       │       └── store.ts        # Zustand stores (auth, editor, chat)
│       ├── next.config.js          # Standalone output, security headers, Monaco webpack
│       ├── tailwind.config.js      # Brand palette, editor typography, animations
│       └── package.json
│
├── packages/
│   ├── db/                         # Drizzle ORM + PostgreSQL (Cloud SQL)
│   │   ├── src/
│   │   │   ├── schema.ts          # 16 tables: users, orgs, projects, files, assets,
│   │   │   │                      #   versions, deployments, domains, oauth, refresh_tokens,
│   │   │   │                      #   ai_conversations, ai_messages, preview_sessions,
│   │   │   │                      #   subscriptions, usage_logs, org_members
│   │   │   ├── client.ts          # Connection pool, health check, SSL config
│   │   │   └── index.ts           # Re-exports
│   │   ├── drizzle.config.ts
│   │   └── package.json
│   │
│   └── shared/                     # Types, constants, templates, validation
│       ├── src/
│       │   ├── types.ts            # 30+ TypeScript interfaces (User, Project, File, etc.)
│       │   ├── constants.ts        # URLs, GCS buckets, plan limits, rate limits, AI config
│       │   ├── templates.ts        # 5 starter templates (blank, landing, portfolio, blog, business)
│       │   ├── validation.ts       # Zod-style validators + slugify
│       │   └── index.ts
│       └── package.json
│
├── infra/
│   ├── docker/
│   │   ├── Dockerfile.api          # Multi-stage: build → production (node:20-alpine)
│   │   └── Dockerfile.web          # Multi-stage: deps → build → standalone Next.js
│   ├── terraform/
│   │   └── main.tf                 # Full GCP IaC: VPC, Cloud SQL (HA), Cloud Run (API + Web),
│   │                               #   GCS buckets, Secret Manager, Artifact Registry,
│   │                               #   Global LB + CDN, SSL certificates, HTTP→HTTPS redirect
│   └── cloudbuild.yaml             # CI/CD: test → build images → push → migrate → deploy
│
├── ecosystem.config.cjs            # PM2 config for local dev (API + Web)
├── .env.example                    # All required environment variables
├── turbo.json                      # Turborepo pipeline config
├── tsconfig.json                   # Root TypeScript config with workspace path aliases
├── package.json                    # Workspaces, scripts, engines
└── .gitignore
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | Next.js 15, React 19, TypeScript, Tailwind CSS, Zustand, Monaco Editor |
| **Backend** | Hono 4, Node.js 20, TypeScript, Zod validation |
| **Database** | PostgreSQL 16 (Cloud SQL), Drizzle ORM |
| **Storage** | Google Cloud Storage (4 buckets: assets, builds, deploys, snapshots) |
| **AI** | Anthropic Claude (claude-sonnet-4-20250514), SSE streaming |
| **Preview** | Novita Sandbox SDK (isolated runtime per project) |
| **Billing** | Stripe (subscriptions, checkout, billing portal, webhooks) |
| **Auth** | JWT (access + refresh tokens), bcrypt, session management |
| **CDN** | Google Cloud CDN + Global Load Balancer |
| **CI/CD** | Google Cloud Build → Artifact Registry → Cloud Run |
| **IaC** | Terraform (VPC, Cloud SQL HA, Cloud Run, GCS, LB, SSL, Secrets) |
| **Monorepo** | Turborepo with npm workspaces |

## API Endpoints

### Auth (`/api/v1/auth`)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/signup` | Create account (email, password, name) |
| POST | `/login` | Authenticate, return JWT tokens |
| POST | `/refresh` | Rotate access token |
| POST | `/logout` | Revoke refresh token |
| GET | `/me` | Get current user profile |
| PATCH | `/me` | Update name / avatar |
| POST | `/change-password` | Change password, revoke all sessions |

### Projects (`/api/v1/projects`)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | List projects (paginated, filterable) |
| GET | `/:id` | Get project with files, assets, versions |
| POST | `/` | Create project (optional template) |
| PATCH | `/:id` | Update project metadata |
| DELETE | `/:id` | Cascade delete project |

### Files (`/api/v1/files`)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/:projectId` | List files (optional content) |
| GET | `/:projectId/:path` | Get single file |
| PUT | `/:projectId` | Upsert single file |
| PUT | `/:projectId/bulk` | Bulk upsert (AI updates) |
| DELETE | `/:projectId/:path` | Delete file |
| POST | `/:projectId/rename` | Rename file |

### Assets (`/api/v1/assets`)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/:projectId` | List assets |
| POST | `/:projectId/upload` | Direct upload (multipart) |
| POST | `/:projectId/upload-url` | Get signed upload URL |
| POST | `/:projectId/confirm-upload` | Confirm direct GCS upload |
| DELETE | `/:projectId/:assetId` | Delete asset |

### AI (`/api/v1/ai`)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/chat` | Send message (non-streaming) |
| POST | `/chat/stream` | Send message (SSE streaming) |
| GET | `/conversations/:projectId` | List conversations |
| GET | `/conversations/:projectId/:id` | Get conversation messages |

### Preview (`/api/v1/preview`)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/start` | Create / reuse Novita sandbox |
| POST | `/update` | Hot-reload files in sandbox |
| GET | `/status/:sessionId` | Check sandbox status |
| POST | `/stop/:sessionId` | Kill sandbox |
| GET | `/logs/:sessionId` | Get sandbox console logs |

### Build (`/api/v1/build`)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/` | Build project (minify, validate, snapshot) |
| GET | `/:projectId/versions` | List version history |
| POST | `/:projectId/restore` | Restore from snapshot |

### Deploy (`/api/v1/deploy`)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/` | Deploy version to CDN |
| GET | `/:projectId` | List deployments |
| POST | `/:projectId/rollback` | Rollback to previous |
| POST | `/:projectId/domains` | Add custom domain |
| POST | `/:projectId/domains/:id/verify` | Verify DNS |
| GET | `/:projectId/domains` | List domains |
| DELETE | `/:projectId/domains/:id` | Remove domain |

### Billing (`/api/v1/billing`)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/usage` | Current month usage metrics |
| POST | `/checkout` | Create Stripe checkout session |
| POST | `/portal` | Open Stripe billing portal |
| GET | `/subscription` | Get subscription details |
| POST | `/webhook` | Stripe webhook handler |

### Health (`/health`)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/live` | Liveness probe |
| GET | `/ready` | Readiness (DB connectivity) |

## Plans & Limits

| Feature | Free | Pro ($19/mo) | Business ($49/mo) | Enterprise |
|---------|------|-------------|-------------------|------------|
| Projects | 3 | 25 | Unlimited | Unlimited |
| AI Messages/mo | 50 | 500 | 2,000 | Unlimited |
| Storage | 100 MB | 5 GB | 25 GB | 500 GB |
| Deploys/mo | 10 | Unlimited | Unlimited | Unlimited |
| Custom Domains | 0 | 3 | 10 | Unlimited |
| Collaborators | 0 | 5 | 25 | Unlimited |
| Max File Size | 5 MB | 25 MB | 50 MB | 200 MB |

## Data Model

16 PostgreSQL tables managed by Drizzle ORM:

- **users** — accounts, plans, org membership
- **organizations** — teams with owner, slug, plan
- **org_members** — user ↔ org roles (owner/admin/editor/viewer)
- **projects** — name, slug, template, settings, status
- **project_files** — path, content, hash, MIME, size
- **project_assets** — uploaded files, GCS keys, CDN URLs, dimensions
- **project_versions** — build snapshots, version numbers
- **deployments** — deploy history, URLs, Lighthouse scores
- **custom_domains** — domain, SSL status, DNS records
- **oauth_accounts** — third-party auth providers
- **refresh_tokens** — hashed tokens, expiry, revocation
- **ai_conversations** — per-project chat threads
- **ai_messages** — role, content, attachments, token usage
- **preview_sessions** — Novita sandbox tracking
- **subscriptions** — Stripe subscription state
- **usage_logs** — per-action metering

## Getting Started

### Prerequisites

- Node.js >= 20
- PostgreSQL 16
- Google Cloud SDK (for GCS + Cloud Run)
- Stripe account (for billing)
- Anthropic API key (for AI)
- Novita API key (for preview sandboxes)

### Local Development

```bash
# 1. Clone
git clone https://github.com/gary790/simplebuildpro.git
cd simplebuildpro

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env
# Edit .env with your real credentials

# 4. Set up database
createdb simplebuildpro
npm run db:push

# 5. Start dev servers (API + Web)
pm2 start ecosystem.config.cjs
# Or individually:
#   npm run dev --workspace=apps/api   (port 8080)
#   npm run dev --workspace=apps/web   (port 3000)

# 6. Open
open http://localhost:3000
```

### Production Deployment

```bash
# 1. Provision infrastructure
cd infra/terraform
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars
terraform init
terraform plan
terraform apply

# 2. Set secrets in Secret Manager
# (DATABASE_URL, JWT_SECRET, STRIPE_SECRET_KEY, etc.)

# 3. Build and deploy via Cloud Build
gcloud builds submit --config=infra/cloudbuild.yaml

# Or manual Docker build:
npm run docker:api
npm run docker:web
```

## Completed Features

- [x] Full REST API with 11 route modules (auth, projects, files, assets, AI, preview, build, deploy, billing, health)
- [x] JWT authentication with refresh token rotation
- [x] Rate limiting per category (auth, API, AI, deploy, upload)
- [x] Global error handling with AppError + Zod validation
- [x] Next.js 15 frontend with landing page, auth flows, dashboard
- [x] Monaco code editor with custom dark theme, IntelliSense, shortcuts
- [x] File tree sidebar with create/rename/delete context menus
- [x] AI chat panel with Claude SSE streaming + file update parser
- [x] Preview panel with Novita sandbox, device toggle, hot-reload
- [x] Dashboard with project grid/list, usage cards, search, create modal
- [x] Settings page with profile, billing (Stripe plans), security tabs
- [x] Zustand state management (auth, editor, chat stores)
- [x] Typed API client with auto-refresh, error handling, SSE support
- [x] 5 starter templates (blank, landing, portfolio, blog, business)
- [x] Drizzle ORM schema with 16 tables + relations
- [x] Multi-stage Docker builds for API and Web
- [x] Cloud Build CI/CD pipeline
- [x] Terraform IaC for full GCP stack (VPC, Cloud SQL HA, Cloud Run, GCS, CDN, LB, SSL, Secrets)
- [x] PM2 ecosystem config for local dev
- [x] Comprehensive .env.example

## Pending / Next Steps

- [ ] Incorporate original website-builder.jsx reference implementation
- [ ] Database migrations directory with versioned SQL files
- [ ] End-to-end tests (Playwright)
- [ ] API integration tests
- [ ] WebSocket real-time collaboration
- [ ] OAuth2 providers (Google, GitHub)
- [ ] MFA / 2FA support
- [ ] Organization invitation flows
- [ ] Asset image optimization pipeline
- [ ] Lighthouse score integration in build step
- [ ] Usage alerting and quota enforcement
- [ ] Admin dashboard
- [ ] Custom domain SSL automation (Let's Encrypt via cert-manager)
- [ ] Load testing and performance benchmarks
- [ ] Monitoring and alerting (Cloud Monitoring + PagerDuty)

## Deployment Status

- **Platform**: Google Cloud (Cloud Run + Cloud SQL + GCS + Cloud CDN)
- **Status**: Infrastructure defined, pending first production deploy
- **Tech Stack**: Hono + Next.js + TypeScript + Tailwind CSS + Drizzle + PostgreSQL
- **Last Updated**: May 2026
