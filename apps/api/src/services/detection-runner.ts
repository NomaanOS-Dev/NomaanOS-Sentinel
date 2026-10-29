import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from '../database/pool.js';
import { config } from '../config/env.js';
import { logger } from '../config/logger.js';
import { alertNotificationService } from './alert-notification-service.js';
import { webhookDispatcher } from './webhook-dispatcher.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface DetectedAlertEvidence {
  event_id: string;
  role: string;
  occurred_at?: string;
  line_number?: number;
  raw_line?: string;
}

export interface DetectedAlert {
  rule_id: string;
  rule_version: string;
  rule_name: string;
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical';
  title: string;
  summary: string;
  reason: string;
  fingerprint: string;
  first_event_at: string;
  last_event_at: string;
  event_count: number;
  evidence_events: DetectedAlertEvidence[];
  metadata: Record<string, unknown>;
  status: string;
}

export interface DetectionResult {
  workspace_id: string;
  alert_count: number;
  evaluated_events_count: number;
  rules_evaluated: number;
  alerts: DetectedAlert[];
}

export class DetectionRunner {
  /**
   * Resolves the filesystem path to the Python sentinel_parser source directory.
   */
  public getParserSrcPath(): string {
    const candidates = [
      path.resolve(__dirname, '../../../../services/parser/src'),
      path.resolve(__dirname, '../../../services/parser/src'),
      path.resolve(process.cwd(), 'services/parser/src'),
      path.resolve(process.cwd(), '../../services/parser/src'),
      path.resolve(process.cwd(), '../services/parser/src'),
    ];

    for (const candidate of candidates) {
      const cliFile = path.join(candidate, 'sentinel_parser', 'detection', 'cli.py');
      if (fs.existsSync(cliFile)) {
        return candidate;
      }
    }

    for (const candidate of candidates) {
      if (fs.existsSync(candidate) && fs.existsSync(path.join(candidate, 'sentinel_parser'))) {
        return candidate;
      }
    }

    throw new Error(
      `DETECTION_CONFIG_ERROR: Unable to locate detection source directory. Checked paths: ${candidates.join(', ')}`
    );
  }

  /**
   * Evaluates security events against deterministic detection rules via Python child process.
   * Safe subprocess execution with bounded timeout and sanitized environment.
   */
  public async runDetectionOnEvents(
    workspaceId: string,
    events: unknown[]
  ): Promise<DetectionResult> {
    if (!events || events.length === 0) {
      return {
        workspace_id: workspaceId,
        alert_count: 0,
        evaluated_events_count: 0,
        rules_evaluated: 4,
        alerts: [],
      };
    }

    const pythonExecutable = config.worker.pythonPath;
    const parserSrc = this.getParserSrcPath();
    const timeoutMs = config.upload.processingTimeoutMs;

    const sanitizedEnv: Record<string, string> = {
      PYTHONPATH: parserSrc,
      PYTHONIOENCODING: 'utf-8',
      PYTHONUNBUFFERED: '1',
    };

    const safeSystemKeys = [
      'PATH', 'Path', 'PATHEXT', 'SystemRoot', 'SYSTEMROOT', 'SystemDrive',
      'TEMP', 'TMP', 'USERPROFILE', 'HOME', 'USER', 'LANG', 'LC_ALL',
      'APPDATA', 'LOCALAPPDATA', 'COMSPEC', 'WINDIR',
    ];
    for (const key of safeSystemKeys) {
      if (process.env[key] !== undefined) {
        sanitizedEnv[key] = process.env[key]!;
      }
    }

    const args = ['-m', 'sentinel_parser.detection.cli', '-', '--workspace-id', workspaceId];

    return new Promise<DetectionResult>((resolve, reject) => {
      let isTimedOut = false;
      const child = spawn(pythonExecutable, args, {
        env: sanitizedEnv,
        shell: false,
      });

      const timer = setTimeout(() => {
        isTimedOut = true;
        child.kill('SIGKILL');
        reject(new Error(`DETECTION_TIMEOUT: Detection evaluation exceeded ${timeoutMs / 1000}s limit`));
      }, timeoutMs);

      let stdoutData = '';
      let stderrData = '';

      child.stdout.on('data', (chunk) => {
        stdoutData += chunk.toString();
        if (stdoutData.length > 50 * 1024 * 1024) {
          child.kill('SIGKILL');
          reject(new Error('DETECTION_ERROR: Output exceeded buffer limit'));
        }
      });

      child.stderr.on('data', (chunk) => {
        stderrData += chunk.toString();
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        if (!isTimedOut) {
          reject(new Error(`DETECTION_SPAWN_ERROR: ${err.message}`));
        }
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        if (isTimedOut) return;

        if (code !== 0) {
          logger.error({ code, stderrData }, 'Detection CLI exited with error');
          reject(new Error(`DETECTION_ERROR: Child process failed: ${stderrData.slice(0, 500)}`));
          return;
        }

        try {
          const parsed = JSON.parse(stdoutData) as DetectionResult;
          resolve(parsed);
        } catch (jsonErr) {
          reject(new Error(`DETECTION_JSON_PARSE_ERROR: ${(jsonErr as Error).message}`));
        }
      });

      // Deliver events JSON payload over stdin
      child.stdin.write(JSON.stringify(events));
      child.stdin.end();
    });
  }

  /**
   * Persists detected alerts and evidence relations into PostgreSQL in a single transaction.
   * Uses ON CONFLICT on (workspace_id, fingerprint) to ensure idempotency.
   */
  public async persistAlerts(
    workspaceId: string,
    datasetId: string | null,
    alerts: DetectedAlert[]
  ): Promise<{ persistedCount: number; alertIds: string[] }> {
    if (!alerts || alerts.length === 0) {
      return { persistedCount: 0, alertIds: [] };
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const alertInsertQuery = `
        INSERT INTO alerts (
          workspace_id, dataset_id, rule_id, rule_version, rule_name,
          severity, status, title, summary, reason, fingerprint,
          first_event_at, last_event_at, event_count, metadata, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8, $9, $10, $11,
          $12, $13, $14, $15, NOW()
        )
        ON CONFLICT (workspace_id, fingerprint) DO UPDATE
        SET updated_at = NOW()
        RETURNING id, fingerprint;
      `;

      const evidenceInsertQuery = `
        INSERT INTO alert_events (alert_id, event_id, role)
        VALUES ($1, $2, $3)
        ON CONFLICT (alert_id, event_id) DO NOTHING;
      `;

      let persistedCount = 0;
      const alertIds: string[] = [];

      for (const alert of alerts) {
        const res = await client.query(alertInsertQuery, [
          workspaceId,
          datasetId,
          alert.rule_id,
          alert.rule_version,
          alert.rule_name,
          alert.severity,
          alert.status || 'open',
          alert.title,
          alert.summary,
          alert.reason,
          alert.fingerprint,
          alert.first_event_at,
          alert.last_event_at,
          alert.event_count,
          JSON.stringify(alert.metadata || {}),
        ]);

        if (res.rows.length > 0) {
          const alertId = res.rows[0].id;
          persistedCount++;
          alertIds.push(alertId);

          // Persist evidence links
          for (const ev of alert.evidence_events) {
            await client.query(evidenceInsertQuery, [
              alertId,
              ev.event_id,
              ev.role || 'supporting',
            ]);
          }
        }
      }

      await client.query('COMMIT');
      return { persistedCount, alertIds };
    } catch (err) {
      await client.query('ROLLBACK');
      logger.error({ err, workspaceId, datasetId }, 'Failed to persist detected alerts');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Orchestrates detection evaluation and persistence for a dataset or agent batch.
   */
  public async runAndPersistDetections(
    workspaceId: string,
    datasetId: string | null,
    events: unknown[]
  ): Promise<{ generatedCount: number; alerts: DetectedAlert[] }> {
    logger.info({ workspaceId, datasetId, eventCount: events.length }, 'Evaluating events against detection engine');
    const result = await this.runDetectionOnEvents(workspaceId, events);
    const { persistedCount, alertIds } = await this.persistAlerts(workspaceId, datasetId, result.alerts);
    
    // Asynchronously dispatch notifications for newly detected or updated alerts
    if (alertIds.length > 0) {
      try {
        await alertNotificationService.dispatchAlertNotifications(workspaceId, alertIds);
      } catch (notifErr) {
        logger.error({ err: notifErr, workspaceId, alertIds }, 'Background notification dispatch failed');
      }

      // Asynchronously dispatch outbound alert webhooks
      try {
        await webhookDispatcher.dispatchAlertWebhooks(workspaceId, alertIds);
      } catch (hookErr) {
        logger.error({ err: hookErr, workspaceId, alertIds }, 'Background outbound webhook dispatch failed');
      }
    }

    logger.info(
      { workspaceId, datasetId, alertCount: result.alerts.length, persistedCount },
      'Detection evaluation and persistence complete'
    );
    return {
      generatedCount: persistedCount,
      alerts: result.alerts,
    };
  }
}

export const detectionRunner = new DetectionRunner();

