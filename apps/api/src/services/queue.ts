import pg from 'pg';
import { pool } from '../database/pool.js';
import { config } from '../config/env.js';
import { logger } from '../config/logger.js';

export interface ClaimedJob {
  id: string;
  dataset_id: string;
  workspace_id: string;
  attempts: number;
  max_attempts: number;
}

export interface ProcessingSummary {
  totalLines: number;
  validLines: number;
  malformedLines: number;
  unsupportedLines?: number;
  skippedLines?: number;
  parserVersion?: string;
}

export class JobQueue {
  public async enqueueJob(
    datasetId: string,
    workspaceId: string,
    dbExecutor: pg.Pool | pg.PoolClient = pool
  ): Promise<string> {
    const query = `
      INSERT INTO processing_jobs (dataset_id, workspace_id, status)
      VALUES ($1, $2, 'queued')
      ON CONFLICT (dataset_id) DO UPDATE
      SET status = 'queued',
          attempts = 0,
          locked_at = NULL,
          locked_by = NULL,
          lease_expires_at = NULL,
          last_error = NULL,
          updated_at = NOW()
      RETURNING id;
    `;
    const res = await dbExecutor.query(query, [datasetId, workspaceId]);
    return res.rows[0].id;
  }

  public async claimNextJob(workerId: string): Promise<ClaimedJob | null> {
    const leaseSeconds = config.worker.leaseDurationSeconds;
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const claimQuery = `
        WITH claimable AS (
          SELECT id FROM processing_jobs
          WHERE (status = 'queued' OR (status = 'processing' AND lease_expires_at < NOW()))
          ORDER BY created_at ASC
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        )
        UPDATE processing_jobs j
        SET status = 'processing',
            locked_at = NOW(),
            locked_by = $1,
            lease_expires_at = NOW() + ($2 || ' seconds')::interval,
            attempts = attempts + 1,
            updated_at = NOW()
        FROM claimable
        WHERE j.id = claimable.id
        RETURNING j.id, j.dataset_id, j.workspace_id, j.attempts, j.max_attempts;
      `;

      const res = await client.query(claimQuery, [workerId, String(leaseSeconds)]);

      if (res.rows.length === 0) {
        await client.query('ROLLBACK');
        return null;
      }

      const job: ClaimedJob = res.rows[0];

      // Atomically update dataset status
      await client.query(
        `UPDATE datasets 
         SET status = 'processing', 
             processing_started_at = COALESCE(processing_started_at, NOW()),
             updated_at = NOW() 
         WHERE id = $1`,
        [job.dataset_id]
      );

      await client.query('COMMIT');
      return job;
    } catch (err) {
      await client.query('ROLLBACK');
      logger.error({ err, workerId }, 'Error claiming next processing job');
      return null;
    } finally {
      client.release();
    }
  }

  public async completeJob(
    jobId: string,
    datasetId: string,
    summary: ProcessingSummary
  ): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(
        `UPDATE datasets 
         SET status = 'completed',
             total_lines = $1,
             valid_lines = $2,
             malformed_lines = $3,
             unsupported_lines = COALESCE($4, 0),
             skipped_lines = COALESCE($5, 0),
             parser_version = $6,
             processing_completed_at = NOW(),
             error_code = NULL,
             error_message = NULL,
             updated_at = NOW()
         WHERE id = $7`,
        [
          summary.totalLines,
          summary.validLines,
          summary.malformedLines,
          summary.unsupportedLines ?? 0,
          summary.skippedLines ?? 0,
          summary.parserVersion ?? '0.1.0',
          datasetId,
        ]
      );

      await client.query(
        `UPDATE processing_jobs 
         SET status = 'completed',
             updated_at = NOW()
         WHERE id = $1`,
        [jobId]
      );

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      logger.error({ err, jobId, datasetId }, 'Error marking job completed');
      throw err;
    } finally {
      client.release();
    }
  }

  public async failJob(
    jobId: string,
    datasetId: string,
    errorCode: string,
    errorMessage: string
  ): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(
        `UPDATE datasets 
         SET status = 'failed',
             error_code = $1,
             error_message = $2,
             processing_completed_at = NOW(),
             updated_at = NOW()
         WHERE id = $3`,
        [errorCode, errorMessage.slice(0, 1024), datasetId]
      );

      await client.query(
        `UPDATE processing_jobs 
         SET status = 'failed',
             last_error = $1,
             updated_at = NOW()
         WHERE id = $2`,
        [errorMessage.slice(0, 1024), jobId]
      );

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      logger.error({ err, jobId, datasetId }, 'Error marking job failed');
      throw err;
    } finally {
      client.release();
    }
  }

  public async renewLease(jobId: string, seconds = 45): Promise<void> {
    try {
      await pool.query(
        `UPDATE processing_jobs 
         SET lease_expires_at = NOW() + ($1 || ' seconds')::interval,
             updated_at = NOW()
         WHERE id = $2 AND status = 'processing'`,
        [String(seconds), jobId]
      );
    } catch (err) {
      logger.warn({ err, jobId }, 'Failed to renew job lease');
    }
  }
}

export const jobQueue = new JobQueue();

