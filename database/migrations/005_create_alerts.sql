-- 005_create_alerts.sql
-- NomaanOS Sentinel: Detections, Alerts, and Event-to-Alert Evidence Links

CREATE TABLE IF NOT EXISTS alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    dataset_id UUID NULL REFERENCES datasets(id) ON DELETE SET NULL,
    rule_id VARCHAR(64) NOT NULL,
    rule_version VARCHAR(32) NOT NULL,
    rule_name VARCHAR(128) NOT NULL,
    severity VARCHAR(16) NOT NULL CHECK (severity IN ('info', 'low', 'medium', 'high', 'critical')),
    status VARCHAR(32) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'resolved', 'dismissed')),
    title VARCHAR(255) NOT NULL,
    summary VARCHAR(2048) NOT NULL,
    reason VARCHAR(2048) NOT NULL,
    fingerprint VARCHAR(64) NOT NULL,
    first_event_at TIMESTAMPTZ NOT NULL,
    last_event_at TIMESTAMPTZ NOT NULL,
    event_count INT NOT NULL DEFAULT 1,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_alerts_workspace_fingerprint UNIQUE (workspace_id, fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_alerts_workspace_created 
    ON alerts (workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_alerts_workspace_status 
    ON alerts (workspace_id, status);

CREATE INDEX IF NOT EXISTS idx_alerts_workspace_severity 
    ON alerts (workspace_id, severity);

CREATE INDEX IF NOT EXISTS idx_alerts_fingerprint 
    ON alerts (workspace_id, fingerprint);

CREATE TABLE IF NOT EXISTS alert_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    alert_id UUID NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
    event_id UUID NOT NULL REFERENCES security_events(id) ON DELETE CASCADE,
    role VARCHAR(32) NOT NULL DEFAULT 'supporting' CHECK (role IN ('trigger', 'supporting', 'preceding_failure', 'subsequent_success', 'privileged_action')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_alert_events UNIQUE (alert_id, event_id)
);

CREATE INDEX IF NOT EXISTS idx_alert_events_alert 
    ON alert_events (alert_id);

CREATE INDEX IF NOT EXISTS idx_alert_events_event 
    ON alert_events (event_id);

