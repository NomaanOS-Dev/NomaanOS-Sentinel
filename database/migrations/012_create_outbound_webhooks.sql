-- 012_create_outbound_webhooks.sql
-- NomaanOS Sentinel: Workspace-Scoped Outbound Webhook Integrations and Delivery Audit Log

-- 1. Create workspace_webhooks table
CREATE TABLE IF NOT EXISTS workspace_webhooks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    url TEXT NOT NULL,
    signing_secret VARCHAR(255) NOT NULL,
    secret_last_rotated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    min_severity VARCHAR(32) NOT NULL DEFAULT 'low' CHECK (min_severity IN ('info', 'low', 'medium', 'high', 'critical')),
    subscribed_rules TEXT[] NOT NULL DEFAULT '{}',
    created_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workspace_webhooks_workspace ON workspace_webhooks (workspace_id);
CREATE INDEX IF NOT EXISTS idx_workspace_webhooks_enabled ON workspace_webhooks (workspace_id, enabled);

-- 2. Create webhook_deliveries table
CREATE TABLE IF NOT EXISTS webhook_deliveries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    webhook_id UUID NOT NULL REFERENCES workspace_webhooks(id) ON DELETE CASCADE,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    event_id VARCHAR(255) NOT NULL,
    alert_id UUID NULL REFERENCES alerts(id) ON DELETE CASCADE,
    payload JSONB NOT NULL,
    status VARCHAR(32) NOT NULL CHECK (status IN ('pending', 'delivered', 'failed', 'retrying', 'blocked_ssrf')),
    http_status_code INT NULL,
    attempt_count INT NOT NULL DEFAULT 1,
    max_attempts INT NOT NULL DEFAULT 3,
    next_retry_at TIMESTAMPTZ NULL,
    last_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    delivered_at TIMESTAMPTZ NULL,
    error_message TEXT NULL,
    response_body_snippet TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_webhook_event_delivery UNIQUE (webhook_id, event_id)
);

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_ws_hook ON webhook_deliveries (workspace_id, webhook_id);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_retry ON webhook_deliveries (status, next_retry_at);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_alert ON webhook_deliveries (alert_id);
