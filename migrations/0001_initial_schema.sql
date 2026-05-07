-- ============================================================
-- SimpleBuild Pro — Migration 0001: Initial Schema
-- PostgreSQL 16 on Cloud SQL
-- Creates all core tables, enums, indexes, and relations
-- ============================================================

-- Enums
CREATE TYPE user_plan AS ENUM ('free', 'pro', 'business', 'enterprise');
CREATE TYPE org_role AS ENUM ('owner', 'admin', 'editor', 'viewer');
CREATE TYPE project_status AS ENUM ('draft', 'published', 'archived');
CREATE TYPE deployment_status AS ENUM ('queued', 'building', 'deploying', 'live', 'failed', 'rolled_back');
CREATE TYPE ssl_status AS ENUM ('pending', 'active', 'expired', 'error');
CREATE TYPE subscription_status AS ENUM ('active', 'past_due', 'canceled', 'trialing');
CREATE TYPE preview_status AS ENUM ('creating', 'running', 'paused', 'stopped', 'error');

-- ─── Users ───────────────────────────────────────────────
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL,
  name VARCHAR(100) NOT NULL,
  password_hash TEXT NOT NULL,
  avatar_url TEXT,
  plan user_plan NOT NULL DEFAULT 'free',
  organization_id UUID,
  email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  totp_secret TEXT,
  totp_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX users_email_idx ON users(email);
CREATE INDEX users_org_idx ON users(organization_id);

-- ─── Organizations ───────────────────────────────────────
CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  slug VARCHAR(48) NOT NULL,
  owner_id UUID NOT NULL,
  plan user_plan NOT NULL DEFAULT 'free',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX orgs_slug_idx ON organizations(slug);
CREATE INDEX orgs_owner_idx ON organizations(owner_id);

-- Add FK after organizations exists
ALTER TABLE users
  ADD CONSTRAINT users_organization_id_fkey
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE SET NULL;

-- ─── Organization Members ────────────────────────────────
CREATE TABLE org_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role org_role NOT NULL DEFAULT 'viewer',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX org_members_org_user_idx ON org_members(organization_id, user_id);
CREATE INDEX org_members_user_idx ON org_members(user_id);

-- ─── Organization Invitations ────────────────────────────
CREATE TABLE org_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  role org_role NOT NULL DEFAULT 'viewer',
  invited_by UUID NOT NULL REFERENCES users(id),
  token VARCHAR(128) NOT NULL,
  accepted_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX invitations_token_idx ON org_invitations(token);
CREATE INDEX invitations_org_idx ON org_invitations(organization_id);
CREATE INDEX invitations_email_idx ON org_invitations(email);

-- ─── OAuth Accounts ──────────────────────────────────────
CREATE TABLE oauth_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider VARCHAR(32) NOT NULL,
  provider_account_id VARCHAR(255) NOT NULL,
  access_token TEXT,
  refresh_token TEXT,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX oauth_provider_idx ON oauth_accounts(provider, provider_account_id);
CREATE INDEX oauth_user_idx ON oauth_accounts(user_id);

-- ─── Refresh Tokens ──────────────────────────────────────
CREATE TABLE refresh_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX refresh_tokens_user_idx ON refresh_tokens(user_id);
CREATE UNIQUE INDEX refresh_tokens_hash_idx ON refresh_tokens(token_hash);

-- ─── Projects ────────────────────────────────────────────
CREATE TABLE projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(64) NOT NULL,
  slug VARCHAR(64) NOT NULL,
  description TEXT,
  template_id VARCHAR(64),
  settings JSONB NOT NULL DEFAULT '{}',
  status project_status NOT NULL DEFAULT 'draft',
  last_deployed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX projects_owner_idx ON projects(owner_id);
CREATE INDEX projects_org_idx ON projects(organization_id);
CREATE UNIQUE INDEX projects_owner_slug_idx ON projects(owner_id, slug);
CREATE INDEX projects_status_idx ON projects(status);

-- ─── Project Files ───────────────────────────────────────
CREATE TABLE project_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  path VARCHAR(512) NOT NULL,
  content TEXT NOT NULL,
  content_hash VARCHAR(64) NOT NULL,
  mime_type VARCHAR(128) NOT NULL DEFAULT 'text/plain',
  size_bytes INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX files_project_path_idx ON project_files(project_id, path);
CREATE INDEX files_project_idx ON project_files(project_id);

-- ─── Project Assets ──────────────────────────────────────
CREATE TABLE project_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  filename VARCHAR(255) NOT NULL,
  original_filename VARCHAR(255) NOT NULL,
  gcs_key TEXT NOT NULL,
  cdn_url TEXT NOT NULL,
  mime_type VARCHAR(128) NOT NULL,
  size_bytes BIGINT NOT NULL,
  width INTEGER,
  height INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX assets_project_idx ON project_assets(project_id);

-- ─── Project Versions ────────────────────────────────────
CREATE TABLE project_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  snapshot_gcs_key TEXT NOT NULL,
  message VARCHAR(255) NOT NULL DEFAULT '',
  created_by UUID NOT NULL REFERENCES users(id),
  file_count INTEGER NOT NULL DEFAULT 0,
  total_size_bytes BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX versions_project_version_idx ON project_versions(project_id, version_number);
CREATE INDEX versions_project_idx ON project_versions(project_id);

-- ─── Deployments ─────────────────────────────────────────
CREATE TABLE deployments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version_id UUID NOT NULL REFERENCES project_versions(id),
  status deployment_status NOT NULL DEFAULT 'queued',
  url TEXT NOT NULL,
  cdn_url TEXT,
  custom_domain VARCHAR(253),
  gcs_prefix TEXT NOT NULL,
  build_duration_ms INTEGER,
  lighthouse_score INTEGER,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX deployments_project_idx ON deployments(project_id);
CREATE INDEX deployments_status_idx ON deployments(status);

-- ─── Custom Domains ──────────────────────────────────────
CREATE TABLE custom_domains (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  domain VARCHAR(253) NOT NULL,
  ssl_status ssl_status NOT NULL DEFAULT 'pending',
  dns_verified BOOLEAN NOT NULL DEFAULT FALSE,
  dns_records JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX domains_domain_idx ON custom_domains(domain);
CREATE INDEX domains_project_idx ON custom_domains(project_id);

-- ─── AI Conversations ────────────────────────────────────
CREATE TABLE ai_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message_count INTEGER NOT NULL DEFAULT 0,
  total_tokens_used INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX conversations_project_idx ON ai_conversations(project_id);
CREATE INDEX conversations_user_idx ON ai_conversations(user_id);

-- ─── AI Messages ─────────────────────────────────────────
CREATE TABLE ai_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  role VARCHAR(16) NOT NULL,
  content TEXT NOT NULL,
  attachments JSONB NOT NULL DEFAULT '[]',
  tokens_used INTEGER NOT NULL DEFAULT 0,
  applied_files BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX messages_conversation_idx ON ai_messages(conversation_id);

-- ─── Preview Sessions ────────────────────────────────────
CREATE TABLE preview_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  novita_sandbox_id VARCHAR(128) NOT NULL,
  preview_url TEXT NOT NULL,
  status preview_status NOT NULL DEFAULT 'creating',
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX preview_project_idx ON preview_sessions(project_id);
CREATE UNIQUE INDEX preview_sandbox_idx ON preview_sessions(novita_sandbox_id);

-- ─── Subscriptions ───────────────────────────────────────
CREATE TABLE subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  stripe_customer_id VARCHAR(128) NOT NULL,
  stripe_subscription_id VARCHAR(128) NOT NULL,
  plan user_plan NOT NULL,
  status subscription_status NOT NULL DEFAULT 'active',
  current_period_end TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX subs_stripe_sub_idx ON subscriptions(stripe_subscription_id);
CREATE INDEX subs_user_idx ON subscriptions(user_id);
CREATE INDEX subs_org_idx ON subscriptions(organization_id);

-- ─── Usage Logs ──────────────────────────────────────────
CREATE TABLE usage_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  type VARCHAR(32) NOT NULL,
  quantity BIGINT NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX usage_user_type_idx ON usage_logs(user_id, type);
CREATE INDEX usage_org_type_idx ON usage_logs(organization_id, type);
CREATE INDEX usage_created_idx ON usage_logs(created_at);

-- ─── Audit Log (for enterprise security) ─────────────────
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(64) NOT NULL,
  resource_type VARCHAR(32) NOT NULL,
  resource_id UUID,
  ip_address VARCHAR(45),
  user_agent TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX audit_user_idx ON audit_logs(user_id);
CREATE INDEX audit_action_idx ON audit_logs(action);
CREATE INDEX audit_resource_idx ON audit_logs(resource_type, resource_id);
CREATE INDEX audit_created_idx ON audit_logs(created_at);
