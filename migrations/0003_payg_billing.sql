-- ============================================================
-- SimpleBuild Pro — Migration 0003: Pay-As-You-Go Billing
-- Adds cost tracking, daily aggregation, Stripe metered billing
-- ============================================================

-- Add cost tracking columns to usage_logs
ALTER TABLE usage_logs ADD COLUMN IF NOT EXISTS cost_cents NUMERIC(10, 4) DEFAULT 0;
ALTER TABLE usage_logs ADD COLUMN IF NOT EXISTS price_cents NUMERIC(10, 4) DEFAULT 0;
ALTER TABLE usage_logs ADD COLUMN IF NOT EXISTS billed BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE usage_logs ADD COLUMN IF NOT EXISTS billing_period DATE;

-- Add Stripe customer fields to users
ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id VARCHAR(128);
ALTER TABLE users ADD COLUMN IF NOT EXISTS billing_status VARCHAR(32) NOT NULL DEFAULT 'free';
-- billing_status: 'free' | 'active' | 'paused' | 'suspended'
ALTER TABLE users ADD COLUMN IF NOT EXISTS daily_spend_limit_cents INTEGER DEFAULT 5000;
ALTER TABLE users ADD COLUMN IF NOT EXISTS payment_method_added BOOLEAN NOT NULL DEFAULT FALSE;

-- Index for billing queries
CREATE INDEX IF NOT EXISTS usage_billed_idx ON usage_logs(billed, billing_period);
CREATE INDEX IF NOT EXISTS usage_user_period_idx ON usage_logs(user_id, billing_period);
CREATE INDEX IF NOT EXISTS users_stripe_idx ON users(stripe_customer_id);
CREATE INDEX IF NOT EXISTS users_billing_status_idx ON users(billing_status);

-- Daily usage aggregation table (for fast billing queries)
CREATE TABLE IF NOT EXISTS daily_usage_summary (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  ai_input_tokens BIGINT NOT NULL DEFAULT 0,
  ai_output_tokens BIGINT NOT NULL DEFAULT 0,
  ai_messages INTEGER NOT NULL DEFAULT 0,
  deploys INTEGER NOT NULL DEFAULT 0,
  storage_bytes BIGINT NOT NULL DEFAULT 0,
  preview_seconds INTEGER NOT NULL DEFAULT 0,
  bandwidth_bytes BIGINT NOT NULL DEFAULT 0,
  total_cost_cents NUMERIC(10, 4) NOT NULL DEFAULT 0,
  total_price_cents NUMERIC(10, 4) NOT NULL DEFAULT 0,
  stripe_reported BOOLEAN NOT NULL DEFAULT FALSE,
  stripe_invoice_item_id VARCHAR(128),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS daily_usage_user_date_idx ON daily_usage_summary(user_id, date);
CREATE INDEX IF NOT EXISTS daily_usage_unreported_idx ON daily_usage_summary(stripe_reported, date);

-- Billing events log (for audit trail)
CREATE TABLE IF NOT EXISTS billing_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(64) NOT NULL,
  -- types: 'payment_method_added', 'payment_method_removed', 'charge_succeeded',
  --        'charge_failed', 'spend_limit_warning', 'spend_limit_reached',
  --        'account_paused', 'account_resumed', 'credit_added'
  amount_cents INTEGER,
  stripe_event_id VARCHAR(128),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS billing_events_user_idx ON billing_events(user_id);
CREATE INDEX IF NOT EXISTS billing_events_type_idx ON billing_events(type);

-- Credits / prepaid balance (optional future use)
ALTER TABLE users ADD COLUMN IF NOT EXISTS credit_balance_cents INTEGER NOT NULL DEFAULT 0;
