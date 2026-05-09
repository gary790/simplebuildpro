-- ============================================================
-- SimpleBuild Pro — Phase 5.2a Migration
-- Creates: dedicated_environments table
-- Date: 2026-05-09
-- ============================================================

CREATE TABLE IF NOT EXISTS dedicated_environments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  tier VARCHAR(16) NOT NULL DEFAULT 'standard',  -- 'standard' | 'premium'
  region VARCHAR(32) NOT NULL DEFAULT 'us-central1',
  status VARCHAR(32) NOT NULL DEFAULT 'provisioning',  -- 'provisioning' | 'active' | 'scaling' | 'deprovisioning' | 'error'
  custom_domain VARCHAR(253),
  cloud_run_service VARCHAR(128),
  gcs_bucket VARCHAR(128),
  database_instance VARCHAR(128),
  redis_instance VARCHAR(128),
  service_url TEXT,
  scaling_config JSONB DEFAULT '{}',
  health_status VARCHAR(16) DEFAULT 'unknown',  -- 'healthy' | 'degraded' | 'down' | 'unknown'
  last_health_check TIMESTAMPTZ,
  provisioned_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT dedicated_env_org_unique UNIQUE (organization_id)
);

CREATE INDEX IF NOT EXISTS dedicated_env_org_idx ON dedicated_environments(organization_id);
CREATE INDEX IF NOT EXISTS dedicated_env_status_idx ON dedicated_environments(status);
CREATE INDEX IF NOT EXISTS dedicated_env_tier_idx ON dedicated_environments(tier);
