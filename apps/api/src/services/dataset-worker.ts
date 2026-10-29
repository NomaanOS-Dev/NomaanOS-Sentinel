import os from 'os';
import crypto from 'crypto';
import { pool } from '../database/pool.js';
import { jobQueue, ClaimedJob } from './queue.js';
import { storageService } from './storage.js';
import { parserRunner } from './parser-runner.js';
import { detectionRunner } from './detection-runner.js';
import { config } from '../config/env.js';
import { logger } from '../config/logger.js';

export class DatasetWorker {
  private workerId: string;
  private isRunning: boolean = false;
  private isProcessing: boolean = false;
  private pollTimeout: NodeJS.Timeout | null = null;

  constructor() {
    this.workerId = `worker_${os.hostname()}_${process.pid}_${crypto.randomBytes(3).toString('hex')}`;
  }

  public getWorkerId(): string {
    return this.workerId;
  }

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    logger.info({ workerId: this.workerId }, 'Dataset processing background worker started');
    this.scheduleNextTick(100);
  }

  public stop(): void {
    this.isRunning = false;
    if (this.pollTimeout) {
      clearTimeout(this.pollTimeout);
      this.pollTimeout = null;
    }
    logger.info({ workerId: this.workerId }, 'Dataset processing background worker stopped');
  }

  public triggerImmediate(): void {
    if (!this.isRunning) return;
    if (this.pollTimeout) {
      clearTimeout(this.pollTimeout);
      this.pollTimeout = null;
    }
    setImmediate(() => this.tick());
  }

  private scheduleNextTick(delayMs = config.worker.pollIntervalMs): void {
    if (!this.isRunning) return;
    this.pollTimeout = setTimeout(() => this.tick(), delayMs);
  }

  public async tick(): Promise<void> {
    if (!this.isRunning || this.isProcessing) return;

    this.isProcessing = true;
    try {
      const job = await jobQueue.claimNextJob(this.workerId);
      if (job) {
        await this.processJob(job);
        // If we found a job, check immediately for another one
        if (this.isRunning) {
          setImmediate(() => this.tick());
          return;
        }
      }
    } catch (err) {
      logger.error({ err, workerId: this.workerId }, 'Error in worker tick loop');
    } finally {
      this.isProcessing = false;
      this.scheduleNextTick();
    }
  }

  public async processJob(job: ClaimedJob): Promise<void> {
    const { id: jobId, dataset_id: datasetId, workspace_id: workspaceId } = job;
    logger.info({ jobId, datasetId, workspaceId, attempt: job.attempts }, 'Claimed dataset processing job');

    try {
      // 1. Fetch dataset record
      const dsRes = await pool.query(
        'SELECT id, storage_key, original_filename FROM datasets WHERE id = $1 AND workspace_id = $2',
        [datasetId, workspaceId]
      );

      if (dsRes.rows.length === 0) {
        await jobQueue.failJob(jobId, datasetId, 'DATASET_NOT_FOUND', 'Dataset record no longer exists');
        return;
      }

      const { storage_key: storageKey } = dsRes.rows[0];

      // 2. Resolve private file path
      const filePath = storageService.getFilePath(workspaceId, storageKey);
      const exists = await storageService.fileExists(workspaceId, storageKey);
      if (!exists) {
        await jobQueue.failJob(jobId, datasetId, 'FILE_NOT_FOUND', 'Stored log file is missing from private storage');
        return;
      }

      // 3. Invoke Python parser child process
      logger.info({ datasetId, filePath }, 'Invoking Python sentinel_parser engine');
      const parseResult = await parserRunner.runParser(filePath, workspaceId);

      // 4. Persist parsed events in database transaction
      const persistedCount = await parserRunner.persistEvents(
        datasetId,
        workspaceId,
        parseResult.events
      );

      // 5. Evaluate deterministic detection rules and persist evidence-backed alerts
      const detectionResult = await detectionRunner.runAndPersistDetections(
        workspaceId,
        datasetId,
        parseResult.events
      );

      // 6. Complete job
      await jobQueue.completeJob(jobId, datasetId, {
        totalLines: parseResult.total_lines,
        validLines: parseResult.valid_count,
        malformedLines: parseResult.malformed_count,
        unsupportedLines: parseResult.unsupported_count ?? 0,
        skippedLines: parseResult.skipped_count ?? 0,
        parserVersion: parseResult.parser_version ?? '0.1.0',
      });

      logger.info(
        {
          datasetId,
          totalLines: parseResult.total_lines,
          validCount: parseResult.valid_count,
          malformedCount: parseResult.malformed_count,
          persistedCount,
          alertCount: detectionResult.generatedCount,
        },
        'Dataset processing completed successfully'
      );
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown processing error';
      logger.error({ err, jobId, datasetId }, 'Dataset processing failed');

      const errorCode = errorMsg.includes('TIMEOUT')
        ? 'PROCESSING_TIMEOUT'
        : errorMsg.includes('SCHEMA')
        ? 'SCHEMA_VALIDATION_ERROR'
        : 'PARSER_ERROR';

      await jobQueue.failJob(jobId, datasetId, errorCode, errorMsg);
    }
  }
}

export const datasetWorker = new DatasetWorker();

