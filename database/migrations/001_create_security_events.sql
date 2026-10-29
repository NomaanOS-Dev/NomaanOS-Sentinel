-- 001_create_security_events.sql
-- NomaanOS Sentinel: Initial Migration for Security Events Table

CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(255) PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS security_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    schema_version VARCHAR(16) NOT NULL DEFAULT '1.0.0',
    tenant_id UUID NULL,
    source_type VARCHAR(64) NOT NULL,
    source_host VARCHAR(255) NULL,
    event_type VARCHAR(64) NOT NULL,
    severity VARCHAR(16) NOT NULL CHECK (severity IN ('info', 'low', 'medium', 'high', 'critical')),
    occurred_at TIMESTAMPTZ NOT NULL,
    observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    username VARCHAR(128) NULL,
    source_ip INET NULL,
    source_port INTEGER NULL CHECK (source_port IS NULL OR (source_port >= 1 AND source_port <= 65535)),
    process_name VARCHAR(128) NULL,
    message VARCHAR(2048) NOT NULL,
    evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
    ingestion_source VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indices for analyst queries, detections, and multi-tenant isolation
CREATE INDEX IF NOT EXISTS idx_security_events_tenant_occurred 
    ON security_events (tenant_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_security_events_event_type 
    ON security_events (event_type);

CREATE INDEX IF NOT EXISTS idx_security_events_severity 
    ON security_events (severity);

CREATE INDEX IF NOT EXISTS idx_security_events_source_ip 
    ON security_events (source_ip);

CREATE INDEX IF NOT EXISTS idx_security_events_username 
    ON security_events (username);

CREATE INDEX IF NOT EXISTS idx_security_events_occurred_at 
    ON security_events (occurred_at DESC);

