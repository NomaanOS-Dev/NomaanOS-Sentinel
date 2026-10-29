-- 009_create_notifications_and_agent_health.sql
-- NomaanOS Sentinel: Workspace Alert Notifications, Agent Health Tracking, and Integration Telemetry Association

-- 1. Associate security_events with integrations for asset attribution
ALTER TABLE security_events 
    ADD COLUMN IF NOT EXISTS integration_id UUID NULL REFERENCES integrations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_security_events_integration 
    ON security_events (integration_id);

CREATE INDEX IF NOT EXISTS idx_security_events_tenant_source_occurred 
    ON security_events (tenant_id, ingestion_source, occurred_at DESC);

-- 2. Expand integrations status check to include degraded and inactive health states
ALTER TABLE integrations DROP CONSTRAINT IF EXISTS integrations_status_check;
ALTER TABLE integrations 
    ADD CONSTRAINT integrations_status_check 
    CHECK (status IN ('pending', 'connected', 'inactive', 'degraded', 'disconnected', 'error', 'revoked'));

-- 3. Workspace Alert Notification Preferences
CREATE TABLE IF NOT EXISTS workspace_notification_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE UNIQUE,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    min_severity VARCHAR(16) NOT NULL DEFAULT 'medium' CHECK (min_severity IN ('info', 'low', 'medium', 'high', 'critical')),
    notify_emails TEXT[] NOT NULL DEFAULT '{}',
    include_evidence_summary BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notification_settings_workspace 
    ON workspace_notification_settings (workspace_id);

-- 4. Alert Notification Delivery Log and Deduplication
CREATE TABLE IF NOT EXISTS alert_notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    alert_id UUID NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
    recipient_email VARCHAR(255) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    last_attempt_at TIMESTAMPTZ NULL,
    sent_at TIMESTAMPTZ NULL,
    error_message VARCHAR(1024) NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_alert_notifications_alert_recipient UNIQUE (alert_id, recipient_email)
);

CREATE INDEX IF NOT EXISTS idx_alert_notifications_workspace_created 
    ON alert_notifications (workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_alert_notifications_alert 
    ON alert_notifications (alert_id);

CREATE INDEX IF NOT EXISTS idx_alert_notifications_status 
    ON alert_notifications (status);

