import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import crypto from 'crypto';
import path from 'path';
import { pool } from '../database/pool.js';
import { authenticate, requireVerified, requireWorkspaceMember } from '../middleware/auth.js';
import { validateLogFile } from '../services/file-validator.js';
import { storageService } from '../services/storage.js';
import { jobQueue } from '../services/queue.js';
import { datasetWorker } from '../services/dataset-worker.js';
import { config } from '../config/env.js';
import { logger } from '../config/logger.js';

export const datasetsRouter = Router({ mergeParams: true });

// Configure bounded in-memory multer
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.upload.maxFileBytes, // 5 MiB hard limit
    files: 1,
  },
});

// Middleware to handle multer file upload errors cleanly
function handleUploadMiddleware(req: Request, res: Response, next: NextFunction) {
  upload.single('file')(req, res, (err: unknown) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          res.status(400).json({
            error: 'Validation Error',
            errorCode: 'FILE_OVERSIZED',
            message: `File size exceeds maximum limit of ${config.upload.maxFileBytes} bytes (5 MiB).`,
          });
          return;
        }
        if (err.code === 'LIMIT_UNEXPECTED_FILE') {
          res.status(400).json({
            error: 'Validation Error',
            errorCode: 'UNEXPECTED_FIELD',
            message: 'Only a single file under the field name "file" is accepted.',
          });
          return;
        }
      }
      res.status(400).json({
        error: 'Upload Error',
        message: err instanceof Error ? err.message : 'Invalid multipart upload',
      });
      return;
    }
    next();
  });
}

// 1. Upload Dataset
datasetsRouter.post(
  '/',
  authenticate,
  requireVerified,
  requireWorkspaceMember('analyst'),
  handleUploadMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceId = req.workspace!.id;
      const userId = req.user!.id;

      if (!req.file || !req.file.buffer) {
        res.status(400).json({
          error: 'Validation Error',
          errorCode: 'FILE_MISSING',
          message: 'A log file must be provided.',
        });
        return;
      }

      // Validate content, size, encoding, and line bounds
      const validation = validateLogFile(req.file.buffer, req.file.originalname);
      if (!validation.valid) {
        res.status(400).json({
          error: 'Validation Error',
          errorCode: validation.errorCode,
          message: validation.message,
        });
        return;
      }

      // Duplicate-detection check within the active workspace
      const duplicateRes = await pool.query(
        `SELECT id, status, original_filename, created_at 
         FROM datasets 
         WHERE workspace_id = $1 AND file_sha256 = $2 
         ORDER BY created_at DESC LIMIT 1`,
        [workspaceId, validation.sha256]
      );

      if (duplicateRes.rows.length > 0) {
        const existing = duplicateRes.rows[0];
        if (existing.status === 'completed') {
          res.status(409).json({
            error: 'Conflict',
            errorCode: 'DUPLICATE_FILE',
            message: 'An identical log file has already been uploaded and processed in this workspace.',
            datasetId: existing.id,
          });
          return;
        }
        if (existing.status === 'queued' || existing.status === 'processing') {
          res.status(409).json({
            error: 'Conflict',
            errorCode: 'DUPLICATE_FILE',
            message: 'An identical log file is currently queued or being processed in this workspace.',
            datasetId: existing.id,
          });
          return;
        }
      }

      // Generate opaque storage key (UUID)
      const storageKey = crypto.randomUUID();

      // Save raw file into private storage
      await storageService.saveFile(workspaceId, storageKey, req.file.buffer);

      // Persist dataset and enqueue background processing job
      const client = await pool.connect();
      let dataset: {
        id: string;
        workspace_id: string;
        original_filename: string;
        file_size_bytes: string;
        status: string;
        created_at: string;
      };

      try {
        await client.query('BEGIN');

        const insertDatasetQuery = `
          INSERT INTO datasets (
            workspace_id, created_by, original_filename, storage_key,
            file_size_bytes, file_sha256, status
          ) VALUES ($1, $2, $3, $4, $5, $6, 'queued')
          RETURNING id, workspace_id, original_filename, file_size_bytes, status, created_at;
        `;

        const dsRes = await client.query(insertDatasetQuery, [
          workspaceId,
          userId,
          validation.sanitizedFilename,
          storageKey,
          validation.sizeBytes,
          validation.sha256,
        ]);

        dataset = dsRes.rows[0];

        // Enqueue job atomically
        await jobQueue.enqueueJob(dataset.id, workspaceId, client);

        await client.query('COMMIT');
      } catch (dbErr) {
        await client.query('ROLLBACK');
        // Clean up stored file if DB insertion failed
        await storageService.deleteFile(workspaceId, storageKey);
        throw dbErr;
      } finally {
        client.release();
      }

      // Trigger immediate worker execution
      datasetWorker.triggerImmediate();

      logger.info(
        {
          datasetId: dataset.id,
          workspaceId,
          userId,
          filename: validation.sanitizedFilename,
          sizeBytes: validation.sizeBytes,
        },
        'Dataset log file uploaded and queued for processing'
      );

      res.status(201).json({
        status: 'created',
        dataset: {
          id: dataset.id,
          workspaceId: dataset.workspace_id,
          originalFilename: dataset.original_filename,
          fileSizeBytes: parseInt(dataset.file_size_bytes, 10),
          status: dataset.status,
          createdAt: dataset.created_at,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// 2. List Workspace Datasets
datasetsRouter.get(
  '/',
  authenticate,
  requireWorkspaceMember('viewer'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceId = req.workspace!.id;
      const limit = Math.min(Math.max(parseInt((req.query.limit as string) || '50', 10), 1), 100);
      const offset = Math.max(parseInt((req.query.offset as string) || '0', 10), 0);

      const listQuery = `
        SELECT 
          d.id,
          d.workspace_id,
          d.created_by,
          u.email AS creator_email,
          d.original_filename,
          d.file_size_bytes,
          d.file_sha256,
          d.status,
          d.total_lines,
          d.valid_lines,
          d.malformed_lines,
          d.unsupported_lines,
          d.skipped_lines,
          d.parser_version,
          d.error_code,
          d.error_message,
          d.retry_count,
          d.uploaded_at,
          d.processing_started_at,
          d.processing_completed_at,
          d.created_at,
          d.updated_at
        FROM datasets d
        JOIN users u ON d.created_by = u.id
        WHERE d.workspace_id = $1
        ORDER BY d.created_at DESC
        LIMIT $2 OFFSET $3;
      `;

      const countQuery = 'SELECT COUNT(*)::int AS total FROM datasets WHERE workspace_id = $1';

      const [dataRes, countRes] = await Promise.all([
        pool.query(listQuery, [workspaceId, limit, offset]),
        pool.query(countQuery, [workspaceId]),
      ]);

      const datasets = dataRes.rows.map((row) => ({
        id: row.id,
        workspaceId: row.workspace_id,
        createdBy: row.created_by,
        creatorEmail: row.creator_email,
        originalFilename: row.original_filename,
        fileSizeBytes: parseInt(row.file_size_bytes, 10),
        fileSha256: row.file_sha256,
        status: row.status,
        totalLines: row.total_lines,
        validLines: row.valid_lines,
        malformedLines: row.malformed_lines,
        unsupportedLines: row.unsupported_lines,
        skippedLines: row.skipped_lines,
        parserVersion: row.parser_version,
        errorCode: row.error_code,
        errorMessage: row.error_message,
        retryCount: row.retry_count,
        uploadedAt: row.uploaded_at,
        processingStartedAt: row.processing_started_at,
        processingCompletedAt: row.processing_completed_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }));

      res.status(200).json({
        status: 'ok',
        workspaceId,
        total: countRes.rows[0].total,
        limit,
        offset,
        datasets,
      });
    } catch (err) {
      next(err);
    }
  }
);

// 3. Get Single Dataset Details
datasetsRouter.get(
  '/:datasetId',
  authenticate,
  requireWorkspaceMember('viewer'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceId = req.workspace!.id;
      const datasetId = String(req.params.datasetId);

      const query = `
        SELECT 
          d.id,
          d.workspace_id,
          d.created_by,
          u.email AS creator_email,
          d.original_filename,
          d.file_size_bytes,
          d.file_sha256,
          d.status,
          d.total_lines,
          d.valid_lines,
          d.malformed_lines,
          d.unsupported_lines,
          d.skipped_lines,
          d.parser_version,
          d.error_code,
          d.error_message,
          d.retry_count,
          d.uploaded_at,
          d.processing_started_at,
          d.processing_completed_at,
          d.created_at,
          d.updated_at
        FROM datasets d
        JOIN users u ON d.created_by = u.id
        WHERE d.id = $1 AND d.workspace_id = $2;
      `;

      const result = await pool.query(query, [datasetId, workspaceId]);
      if (result.rows.length === 0) {
        res.status(404).json({ error: 'Not Found', message: 'Dataset not found.' });
        return;
      }

      const row = result.rows[0];
      res.status(200).json({
        status: 'ok',
        dataset: {
          id: row.id,
          workspaceId: row.workspace_id,
          createdBy: row.created_by,
          creatorEmail: row.creator_email,
          originalFilename: row.original_filename,
          fileSizeBytes: parseInt(row.file_size_bytes, 10),
          fileSha256: row.file_sha256,
          status: row.status,
          totalLines: row.total_lines,
          validLines: row.valid_lines,
          malformedLines: row.malformed_lines,
          unsupportedLines: row.unsupported_lines,
          skippedLines: row.skipped_lines,
          parserVersion: row.parser_version,
          errorCode: row.error_code,
          errorMessage: row.error_message,
          retryCount: row.retry_count,
          uploadedAt: row.uploaded_at,
          processingStartedAt: row.processing_started_at,
          processingCompletedAt: row.processing_completed_at,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// 4. Retry Failed Processing Job
datasetsRouter.post(
  '/:datasetId/retry',
  authenticate,
  requireWorkspaceMember('admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceId = req.workspace!.id;
      const datasetId = String(req.params.datasetId);

      const dsRes = await pool.query(
        'SELECT id, status, error_code FROM datasets WHERE id = $1 AND workspace_id = $2',
        [datasetId, workspaceId]
      );

      if (dsRes.rows.length === 0) {
        res.status(404).json({ error: 'Not Found', message: 'Dataset not found.' });
        return;
      }

      const dataset = dsRes.rows[0];

      if (dataset.status !== 'failed') {
        res.status(400).json({
          error: 'Bad Request',
          message: 'Only failed datasets can be retried.',
        });
        return;
      }

      // Check for permanent validation failures that cannot be retried
      const permanentErrors = ['FILE_EMPTY', 'INVALID_ENCODING_OR_BINARY', 'LINE_OVERLONG', 'FILE_TOO_MANY_LINES'];
      if (dataset.error_code && permanentErrors.includes(dataset.error_code)) {
        res.status(400).json({
          error: 'Bad Request',
          message: 'Cannot retry dataset with permanent validation failure.',
          errorCode: dataset.error_code,
        });
        return;
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Delete any partial events persisted during the failed attempt
        await client.query(
          'DELETE FROM security_events WHERE dataset_id = $1 AND tenant_id = $2',
          [datasetId, workspaceId]
        );

        // Reset dataset status to queued and increment retry count
        await client.query(
          `UPDATE datasets 
           SET status = 'queued',
               error_code = NULL,
               error_message = NULL,
               retry_count = retry_count + 1,
               processing_started_at = NULL,
               processing_completed_at = NULL,
               updated_at = NOW()
           WHERE id = $1`,
          [datasetId]
        );

        // Re-enqueue job
        await jobQueue.enqueueJob(datasetId, workspaceId, client);

        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }

      datasetWorker.triggerImmediate();

      logger.info({ datasetId, workspaceId, userId: req.user!.id }, 'Dataset re-queued for processing');

      res.status(200).json({
        status: 'ok',
        message: 'Dataset re-queued for processing.',
        datasetId,
      });
    } catch (err) {
      next(err);
    }
  }
);

// 5. Download Raw Log File (Workspace-Scoped)
datasetsRouter.get(
  '/:datasetId/raw',
  authenticate,
  requireWorkspaceMember('viewer'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceId = req.workspace!.id;
      const datasetId = String(req.params.datasetId);

      const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!UUID_REGEX.test(datasetId)) {
        res.status(404).json({ error: 'Not Found', message: 'Dataset not found.' });
        return;
      }

      const dsRes = await pool.query(
        'SELECT id, original_filename, storage_key FROM datasets WHERE id = $1 AND workspace_id = $2',
        [datasetId, workspaceId]
      );

      if (dsRes.rows.length === 0) {
        res.status(404).json({ error: 'Not Found', message: 'Dataset not found.' });
        return;
      }

      const { original_filename: filename, storage_key: storageKey } = dsRes.rows[0];

      const exists = await storageService.fileExists(workspaceId, storageKey);
      if (!exists) {
        res.status(404).json({ error: 'Not Found', message: 'Raw log file not found in storage.' });
        return;
      }

      const stream = await storageService.getFileStream(workspaceId, storageKey);
      const safeFilename = path.basename(filename || 'raw-log.log').replace(/["\r\n\\]/g, '_');
      const disposition = req.query.inline === 'true' || req.query.inline === '1' ? 'inline' : 'attachment';

      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Content-Disposition', `${disposition}; filename="${safeFilename}"`);
      res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
      res.setHeader('X-Content-Type-Options', 'nosniff');

      stream.on('error', (streamErr) => {
        logger.error({ streamErr, datasetId, workspaceId }, 'Error streaming raw log file');
        if (!res.headersSent) {
          res.status(500).json({ error: 'Internal Server Error', message: 'Failed to stream raw log file.' });
        }
      });

      stream.pipe(res);
    } catch (err) {
      next(err);
    }
  }
);
