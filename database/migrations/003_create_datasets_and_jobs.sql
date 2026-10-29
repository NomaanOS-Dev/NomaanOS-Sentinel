-- 003_create_datasets_and_jobs.sql
-- NomaanOS Sentinel: Datasets, File Ingestion, and Background Processing Jobs

CREATE TABLE IF NOT EXISTS datasets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    original_filename VARCHAR(255) NOT NULL,
    storage_key VARCHAR(255) NOT NULL UNIQUE,
    file_size_bytes BIGINT NOT NULL,
    file_sha256 VARCHAR(64) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
    total_lines INTEGER NULL,
    valid_lines INTEGER NULL,
    malformed_lines INTEGER NULL,
    error_code VARCHAR(64) NULL,
    error_message VARCHAR(1024) NULL,
    retry_count INTEGER NOT NULL DEFAULT 0,
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processing_started_at TIMESTAMPTZ NULL,
    processing_completed_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_datasets_workspace_created 
    ON datasets (workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_datasets_workspace_sha256 
    ON datasets (workspace_id, file_sha256);

CREATE INDEX IF NOT EXISTS idx_datasets_status 
    ON datasets (status);

-- Associate security_events with dataset_id for traceability
ALTER TABLE security_events 
    ADD COLUMN IF NOT EXISTS dataset_id UUID NULL REFERENCES datasets(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_security_events_dataset 
    ON security_events (dataset_id);

CREATE TABLE IF NOT EXISTS processing_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dataset_id UUID NOT NULL REFERENCES datasets(id) ON DELETE CASCADE UNIQUE,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    status VARCHAR(32) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    locked_at TIMESTAMPTZ NULL,
    locked_by VARCHAR(255) NULL,
    lease_expires_at TIMESTAMPTZ NULL,
    last_error VARCHAR(1024) NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_processing_jobs_queue 
    ON processing_jobs (status, lease_expires_at) 
    WHERE status IN ('queued', 'processing');

CREATE INDEX IF NOT EXISTS idx_processing_jobs_workspace 
    ON processing_jobs (workspace_id);

