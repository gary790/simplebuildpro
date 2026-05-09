-- ============================================================
-- SimpleBuild Pro — Phase 5 Migration
-- Creates: audit_logs, org_sso_configs tables
-- Date: 2026-05-09
-- ============================================================

-- ─── Audit Logs ─────────────────────────────────────────────
-- Enterprise audit trail for all security-relevant actions
-- Supports batched inserts, GDPR anonymization, SIEM export
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
  action VARCHAR(64) NOT NULL,
  resource_type VARCHAR(32),
  resource_id VARCHAR(255),
  metadata JSONB DEFAULT '{}',
  ip_address VARCHAR(45),       -- IPv4 or IPv6
  user_agent VARCHAR(512),
  severity VARCHAR(16) NOT NULL DEFAULT 'info',  -- 'info' | 'warning' | 'critical'
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for audit_logs
CREATE INDEX IF NOT EXISTS audit_logs_user_idx ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS audit_logs_org_idx ON audit_logs(organization_id);
CREATE INDEX IF NOT EXISTS audit_logs_action_idx ON audit_logs(action);
CREATE INDEX IF NOT EXISTS audit_logs_severity_idx ON audit_logs(severity);
CREATE INDEX IF NOT EXISTS audit_logs_created_idx ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_resource_idx ON audit_logs(resource_type, resource_id);

-- Composite index for common query: user's audit trail sorted by time
CREATE INDEX IF NOT EXISTS audit_logs_user_created_idx ON audit_logs(user_id, created_at DESC);

-- ─── SSO Configurations ─────────────────────────────────────
-- Per-organization SSO config (SAML 2.0 / OIDC)
-- Encrypted storage for certificates and client secrets
CREATE TABLE IF NOT EXISTS org_sso_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider VARCHAR(16) NOT NULL,  -- 'saml' | 'oidc'
  -- SAML fields
  entity_id TEXT,
  sso_url TEXT,
  certificate_encrypted TEXT,     -- AES-256-CBC encrypted
  -- OIDC fields
  issuer TEXT,
  client_id VARCHAR(255),
  client_secret_encrypted TEXT,   -- AES-256-CBC encrypted
  discovery_url TEXT,
  -- Common fields
  allowed_domains JSONB NOT NULL DEFAULT '[]',
  auto_provision BOOLEAN NOT NULL DEFAULT true,
  default_role VARCHAR(16) NOT NULL DEFAULT 'viewer',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- One SSO config per org
  CONSTRAINT org_sso_configs_org_unique UNIQUE (organization_id)
);

-- Indexes for org_sso_configs
CREATE INDEX IF NOT EXISTS org_sso_configs_org_idx ON org_sso_configs(organization_id);
CREATE INDEX IF NOT EXISTS org_sso_configs_provider_idx ON org_sso_configs(provider);

-- ─── Org Branding (white-label) ─────────────────────────────
-- Custom branding settings per organization
CREATE TABLE IF NOT EXISTS org_branding (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  logo_url TEXT,
  favicon_url TEXT,
  primary_color VARCHAR(7) DEFAULT '#2563eb',   -- hex
  accent_color VARCHAR(7) DEFAULT '#7c3aed',
  custom_domain VARCHAR(253),
  custom_css TEXT,
  footer_text VARCHAR(255),
  support_email VARCHAR(255),
  support_url TEXT,
  hide_simplebuild_branding BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT org_branding_org_unique UNIQUE (organization_id)
);

CREATE INDEX IF NOT EXISTS org_branding_org_idx ON org_branding(organization_id);
