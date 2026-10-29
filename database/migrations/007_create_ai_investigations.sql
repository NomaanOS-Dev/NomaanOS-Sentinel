-- 007_create_ai_investigations.sql
-- NomaanOS Sentinel: AI Investigation Assistant Records and Usage History

CREATE TABLE IF NOT EXISTS case_ai_investigations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    requested_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    provider VARCHAR(64) NOT NULL,
    model VARCHAR(128) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'failed')),
    prompt_tokens INT NOT NULL DEFAULT 0,
    completion_tokens INT NOT NULL DEFAULT 0,
    duration_ms INT NOT NULL DEFAULT 0,
    response_json JSONB NULL,
    error_message TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_investigations_case 
    ON case_ai_investigations (case_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_investigations_workspace 
    ON case_ai_investigations (workspace_id, created_at DESC);

