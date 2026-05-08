-- ============================================================
-- SimpleBuild Pro — Migration 0005: User Connections (Integrations)
-- Stores encrypted tokens for GitHub (repo scope), Cloudflare, Vercel, Netlify, Supabase
-- ============================================================

-- User-level connections (one per provider per user)
CREATE TABLE IF NOT EXISTS user_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider VARCHAR(32) NOT NULL, -- 'github_repo', 'cloudflare', 'vercel', 'netlify', 'supabase'
  display_name VARCHAR(255), -- e.g. "gary790" or "my-cf-account"
  access_token TEXT, -- encrypted
  refresh_token TEXT, -- encrypted (if applicable)
  token_expires_at TIMESTAMPTZ,
  account_id VARCHAR(255), -- provider-specific account/org ID
  metadata JSONB NOT NULL DEFAULT '{}', -- provider-specific extra data (scopes, username, etc.)
  connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT user_connections_provider_unique UNIQUE(user_id, provider)
);

CREATE INDEX idx_user_connections_user ON user_connections(user_id);
CREATE INDEX idx_user_connections_provider ON user_connections(provider);

-- Project-level integration settings (which connection + config per project)
CREATE TABLE IF NOT EXISTS project_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  provider VARCHAR(32) NOT NULL, -- 'github', 'cloudflare', 'vercel', 'netlify'
  connection_id UUID REFERENCES user_connections(id) ON DELETE SET NULL,
  config JSONB NOT NULL DEFAULT '{}', -- provider-specific: repo, branch, project_name, etc.
  last_action_at TIMESTAMPTZ,
  last_action_result JSONB, -- { status, url, error, etc. }
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT project_integrations_provider_unique UNIQUE(project_id, provider)
);

CREATE INDEX idx_project_integrations_project ON project_integrations(project_id);
CREATE INDEX idx_project_integrations_connection ON project_integrations(connection_id);

-- Environment variables / secrets for projects (user API keys for Stripe, Resend, etc.)
CREATE TABLE IF NOT EXISTS project_env_vars (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  key VARCHAR(128) NOT NULL,
  value TEXT NOT NULL, -- encrypted at rest
  is_secret BOOLEAN NOT NULL DEFAULT true,
  description VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT project_env_vars_unique UNIQUE(project_id, key)
);

CREATE INDEX idx_project_env_vars_project ON project_env_vars(project_id);
