-- 004_add_dataset_processing_metadata.sql
-- NomaanOS Sentinel: Add unsupported_lines, skipped_lines, and parser_version to datasets

ALTER TABLE datasets 
    ADD COLUMN IF NOT EXISTS unsupported_lines INTEGER NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS skipped_lines INTEGER NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS parser_version VARCHAR(32) NULL;

