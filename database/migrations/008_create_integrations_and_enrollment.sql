-- 008_create_integrations_and_enrollment.sql
-- NomaanOS Sentinel: Monitored Assets, Integrations Lifecycle, Enrollment Tokens, and Agent Credentials

CREATE TABLE IF NOT EXISTS integrations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    integration_type VARCHAR(64) NOT NULL DEFAULT 'linux_auth' CHECK (integration_type IN ('linux_auth')),
    status VARCHAR(32) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'connected', 'disconnected', 'error', 'revoked')),
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    agent_id UUID NULL,
    last_seen_at TIMESTAMPTZ NULL,
    last_error_message VARCHAR(1024) NULL,
    last_error_at TIMESTAMPTZ NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_integrations_workspace_created 
    ON integrations (workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_integrations_workspace_status 
    ON integrations (workspace_id, status);

CREATE INDEX IF NOT EXISTS idx_integrations_agent 
    ON integrations (agent_id);

CREATE TABLE IF NOT EXISTS enrollment_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    integration_id UUID NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    token_hash VARCHAR(64) NOT NULL UNIQUE,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    expires_at TIMESTAMPTZ NOT NULL,
    is_revoked BOOLEAN NOT NULL DEFAULT FALSE,
    revoked_at TIMESTAMPTZ NULL,
    revoked_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    used_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_enrollment_tokens_hash 
    ON enrollment_tokens (token_hash);

CREATE INDEX IF NOT EXISTS idx_enrollment_tokens_integration 
    ON enrollment_tokens (integration_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_enrollment_tokens_workspace 
    ON enrollment_tokens (workspace_id);

CREATE TABLE IF NOT EXISTS agent_credentials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL UNIQUE,
    integration_id UUID NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    credential_hash VARCHAR(64) NOT NULL UNIQUE,
    is_revoked BOOLEAN NOT NULL DEFAULT FALSE,
    revoked_at TIMESTAMPTZ NULL,
    revoked_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_authenticated_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_credentials_hash 
    ON agent_credentials (credential_hash);

CREATE INDEX IF NOT EXISTS idx_agent_credentials_integration 
    ON agent_credentials (integration_id);

CREATE INDEX IF NOT EXISTS idx_agent_credentials_agent 
    ON agent_credentials (agent_id);

CREATE TABLE IF NOT EXISTS integration_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    integration_id UUID NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    actor_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(64) NOT NULL,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_integration_audit_logs_integration 
    ON integration_audit_logs (integration_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_integration_audit_logs_workspace 
    ON integration_audit_logs (workspace_id, created_at DESC);

