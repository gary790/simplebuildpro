-- ============================================================
-- SimpleBuild Pro — Migration 0002: MFA, OAuth, Invitations
-- Adds TOTP columns, org invitations table, audit log
-- Run after 0001_initial_schema.sql
-- ============================================================

-- Add MFA fields to users (if not already present from 0001)
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN NOT NULL DEFAULT FALSE;

-- Add recovery codes for MFA
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_recovery_codes JSONB DEFAULT '[]';

-- Add profile fields for OAuth
ALTER TABLE users ADD COLUMN IF NOT EXISTS oauth_provider VARCHAR(32);

-- Ensure org_invitations table exists (created in 0001 but adding IF NOT EXISTS)
CREATE TABLE IF NOT EXISTS org_invitations (
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

CREATE UNIQUE INDEX IF NOT EXISTS invitations_token_idx ON org_invitations(token);
CREATE INDEX IF NOT EXISTS invitations_org_idx ON org_invitations(organization_id);
CREATE INDEX IF NOT EXISTS invitations_email_idx ON org_invitations(email);

-- Ensure audit_logs table exists
CREATE TABLE IF NOT EXISTS audit_logs (
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

CREATE INDEX IF NOT EXISTS audit_user_idx ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS audit_action_idx ON audit_logs(action);
CREATE INDEX IF NOT EXISTS audit_resource_idx ON audit_logs(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS audit_created_idx ON audit_logs(created_at);

-- Add lighthouse scoring to deployments
ALTER TABLE deployments ADD COLUMN IF NOT EXISTS lighthouse_performance INTEGER;
ALTER TABLE deployments ADD COLUMN IF NOT EXISTS lighthouse_accessibility INTEGER;
ALTER TABLE deployments ADD COLUMN IF NOT EXISTS lighthouse_best_practices INTEGER;
ALTER TABLE deployments ADD COLUMN IF NOT EXISTS lighthouse_seo INTEGER;
