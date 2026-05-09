-- Phase 5 fix: add missing organization_id column to audit_logs
-- and create remaining indexes
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS resource_type VARCHAR(32);
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS resource_id VARCHAR(255);
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS severity VARCHAR(16) DEFAULT 'info';

CREATE INDEX IF NOT EXISTS audit_logs_org_idx ON audit_logs(organization_id);
CREATE INDEX IF NOT EXISTS audit_logs_action_idx ON audit_logs(action);
CREATE INDEX IF NOT EXISTS audit_logs_severity_idx ON audit_logs(severity);
CREATE INDEX IF NOT EXISTS audit_logs_created_idx ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_resource_idx ON audit_logs(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS audit_logs_user_created_idx ON audit_logs(user_id, created_at DESC);
