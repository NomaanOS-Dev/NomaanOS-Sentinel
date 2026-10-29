import pg from 'pg';
import { config } from '../config/env.js';
import { logger } from '../config/logger.js';

const { Pool } = pg;

export const pool = new Pool({
  host: config.database.host,
  port: config.database.port,
  database: config.database.name,
  user: config.database.user,
  password: config.database.password,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 3000,
});

pool.on('error', (err) => {
  logger.error({ error: err.message }, 'Unexpected idle client error on database pool');
});

export async function checkDatabaseConnection(timeoutMs = 2000): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
  const start = Date.now();
  try {
    const client = await Promise.race([
      pool.connect(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Database connection timed out')), timeoutMs)
      ),
    ]);

    try {
      await client.query('SELECT 1');
      const latencyMs = Date.now() - start;
      return { ok: true, latencyMs };
    } finally {
      client.release();
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown database error';
    // Redact any potential credentials in connection errors
    const sanitizedError = errorMsg.replace(/postgresql:\/\/[^@]+@/gi, 'postgresql://[REDACTED]@');
    return { ok: false, error: sanitizedError };
  }
}

