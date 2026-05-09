-- ============================================================
-- SimpleBuild Pro — Phase 5 Migration (SSO + Branding only)
-- audit_logs already exists, just need org_sso_configs + org_branding
-- Date: 2026-05-09
-- ============================================================

-- ─── SSO Configurations ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS org_sso_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider VARCHAR(16) NOT NULL,
  entity_id TEXT,
  sso_url TEXT,
  certificate_encrypted TEXT,
  issuer TEXT,
  client_id VARCHAR(255),
  client_secret_encrypted TEXT,
  discovery_url TEXT,
  allowed_domains JSONB NOT NULL DEFAULT '[]',
  auto_provision BOOLEAN NOT NULL DEFAULT true,
  default_role VARCHAR(16) NOT NULL DEFAULT 'viewer',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT org_sso_configs_org_unique UNIQUE (organization_id)
);

CREATE INDEX IF NOT EXISTS org_sso_configs_org_idx ON org_sso_configs(organization_id);
CREATE INDEX IF NOT EXISTS org_sso_configs_provider_idx ON org_sso_configs(provider);

-- ─── Org Branding (white-label) ─────────────────────────────
CREATE TABLE IF NOT EXISTS org_branding (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  logo_url TEXT,
  favicon_url TEXT,
  primary_color VARCHAR(7) DEFAULT '#2563eb',
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

-- ─── Add missing indexes to audit_logs if they don't exist ──
CREATE INDEX IF NOT EXISTS audit_logs_user_idx ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS audit_logs_org_idx ON audit_logs(organization_id);
CREATE INDEX IF NOT EXISTS audit_logs_action_idx ON audit_logs(action);
CREATE INDEX IF NOT EXISTS audit_logs_severity_idx ON audit_logs(severity);
CREATE INDEX IF NOT EXISTS audit_logs_created_idx ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_resource_idx ON audit_logs(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS audit_logs_user_created_idx ON audit_logs(user_id, created_at DESC);
