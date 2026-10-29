import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from '../database/pool.js';
import { config } from '../config/env.js';
import { logger } from '../config/logger.js';
import { validateSecurityEvent } from './schema-validator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface ParsedEventEvidence {
  raw_line: string;
  line_number: number;
  process_id?: number;
  auth_method?: string;
  [key: string]: unknown;
}

export interface ParsedEvent {
  id: string;
  schema_version: string;
  tenant_id: string;
  source_type: string;
  source_host: string | null;
  event_type: string;
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical';
  occurred_at: string;
  observed_at: string;
  username: string | null;
  source_ip: string | null;
  source_port: number | null;
  process_name: string | null;
  message: string;
  evidence: ParsedEventEvidence;
  ingestion_source: string;
}

export interface ParserResult {
  file: string;
  total_lines: number;
  valid_count: number;
  malformed_count: number;
  unsupported_count?: number;
  skipped_count?: number;
  parser_version?: string;
  events: ParsedEvent[];
}

export class ParserRunner {
  /**
   * Resolves the filesystem path to the Python sentinel_parser source directory.
   * Works across repository root, workspace directories, and compiled dist targets.
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
      const cliFile = path.join(candidate, 'sentinel_parser', 'cli.py');
      if (fs.existsSync(cliFile)) {
        return candidate;
      }
    }

    // Secondary fallback: directory exists and contains sentinel_parser package
    for (const candidate of candidates) {
      if (fs.existsSync(candidate) && fs.existsSync(path.join(candidate, 'sentinel_parser'))) {
        return candidate;
      }
    }

    throw new Error(
      `PARSER_CONFIG_ERROR: Unable to locate parser source directory. Checked paths: ${candidates.join(', ')}`
    );
  }

  /**
   * Verifies Python executable path and parser entry point to prevent silent failures.
   */
  public verifyEnvironment(): { pythonExecutable: string; parserSrc: string; cliPath: string } {
    const pythonExecutable = config.worker.pythonPath;
    const parserSrc = this.getParserSrcPath();
    const cliPath = path.join(parserSrc, 'sentinel_parser', 'cli.py');

    if (!fs.existsSync(cliPath)) {
      throw new Error(`PARSER_CONFIG_ERROR: Parser entry point not found at '${cliPath}'`);
    }

    // If pythonExecutable is a specific path, verify that the binary exists
    if (path.isAbsolute(pythonExecutable) || pythonExecutable.includes('/') || pythonExecutable.includes('\\')) {
      if (!fs.existsSync(pythonExecutable)) {
        throw new Error(`PARSER_CONFIG_ERROR: Configured Python executable not found at '${pythonExecutable}'`);
      }
    }

    return { pythonExecutable, parserSrc, cliPath };
  }

  /**
   * Spawns the Python parser engine safely to parse a log file.
   * Uses argument array (no shell interpolation), sanitized environment (no leaked secrets),
   * timeouts, and output limits.
   */
  public async runParser(filePath: string, workspaceId: string): Promise<ParserResult> {
    const { pythonExecutable, parserSrc } = this.verifyEnvironment();
    const timeoutMs = config.upload.processingTimeoutMs;

    const resolvedFilePath = path.resolve(filePath);
    if (!fs.existsSync(resolvedFilePath)) {
      throw new Error(`PARSER_ERROR: File to parse does not exist at '${resolvedFilePath}'`);
    }

    // Build sanitized environment without exposing application secrets (e.g. DB passwords, session secrets)
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

    const args = ['-m', 'sentinel_parser.cli', resolvedFilePath, '--tenant-id', workspaceId];

    return new Promise<ParserResult>((resolve, reject) => {
      let isTimedOut = false;
      const child = spawn(pythonExecutable, args, {
        env: sanitizedEnv,
        shell: false,
      });

      const timer = setTimeout(() => {
        isTimedOut = true;
        child.kill('SIGKILL');
        reject(new Error(`PROCESSING_TIMEOUT: Parsing exceeded maximum timeout of ${timeoutMs / 1000}s`));
      }, timeoutMs);

      let stdoutData = '';
      let stderrData = '';

      child.stdout.on('data', (chunk) => {
        stdoutData += chunk.toString();
        // Prevent unbounded memory consumption from misbehaving child process
        if (stdoutData.length > 50 * 1024 * 1024) {
          child.kill('SIGKILL');
          reject(new Error('PARSER_ERROR: Parser output exceeded maximum buffer limit'));
        }
      });

      child.stderr.on('data', (chunk) => {
        stderrData += chunk.toString();
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        if (!isTimedOut) {
          reject(new Error(`PARSER_SPAWN_ERROR: Failed to invoke parser process: ${err.message}`));
        }
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        if (isTimedOut) return;

        if (code !== 0) {
          logger.error({ code, stderrData }, 'Parser CLI exited with non-zero code');
          reject(new Error(`PARSER_ERROR: Parser exited with code ${code}: ${stderrData.slice(0, 500)}`));
          return;
        }

        try {
          const parsed = JSON.parse(stdoutData) as ParserResult;
          if (typeof parsed.total_lines !== 'number' || !Array.isArray(parsed.events)) {
            reject(new Error('PARSER_ERROR: Malformed JSON output returned by parser'));
            return;
          }
          resolve(parsed);
        } catch (jsonErr) {
          reject(new Error(`PARSER_ERROR: Failed to parse JSON output: ${(jsonErr as Error).message}`));
        }
      });
    });
  }

  public async persistEvents(
    datasetId: string,
    workspaceId: string,
    events: ParsedEvent[]
  ): Promise<number> {
    if (events.length === 0) {
      return 0;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const insertQuery = `
        INSERT INTO security_events (
          id, schema_version, tenant_id, source_type, source_host,
          event_type, severity, occurred_at, observed_at, username,
          source_ip, source_port, process_name, message, evidence,
          ingestion_source, dataset_id
        ) VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8, $9, $10,
          $11, $12, $13, $14, $15,
          $16, $17
        );
      `;

      for (const ev of events) {
        // Enforce canonical schema compliance
        const val = validateSecurityEvent(ev);
        if (!val.valid) {
          const errList = val.errors ? val.errors.join(', ') : 'Schema check failed';
          throw new Error(`SCHEMA_VALIDATION_ERROR: Event ${ev.id} failed canonical schema: ${errList}`);
        }

        const values = [
          ev.id,
          ev.schema_version,
          workspaceId,
          ev.source_type,
          ev.source_host || null,
          ev.event_type,
          ev.severity,
          ev.occurred_at,
          ev.observed_at || new Date().toISOString(),
          ev.username || null,
          ev.source_ip || null,
          ev.source_port || null,
          ev.process_name || null,
          ev.message,
          JSON.stringify(ev.evidence || {}),
          ev.ingestion_source || 'file_upload',
          datasetId,
        ];

        await client.query(insertQuery, values);
      }

      await client.query('COMMIT');
      return events.length;
    } catch (err) {
      await client.query('ROLLBACK');
      logger.error({ err, datasetId, workspaceId }, 'Failed to persist parsed security events');
      throw err;
    } finally {
      client.release();
    }
  }
}

export const parserRunner = new ParserRunner();
