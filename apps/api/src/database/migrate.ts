import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from './pool.js';
import { logger } from '../config/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function runMigrations(): Promise<{ applied: string[]; skipped: string[] }> {
  const client = await pool.connect();
  const applied: string[] = [];
  const skipped: string[] = [];

  try {
    await client.query('BEGIN');

    // Ensure migrations table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version VARCHAR(255) PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // Find migrations folder relative to workspace root or current dir
    const potentialDirs = [
      path.resolve(__dirname, '../../../../database/migrations'),
      path.resolve(process.cwd(), 'database/migrations'),
      path.resolve(process.cwd(), '../../database/migrations'),
    ];

    const migrationsDir = potentialDirs.find((dir) => fs.existsSync(dir));
    if (!migrationsDir) {
      throw new Error(`Migrations directory not found in: ${potentialDirs.join(', ')}`);
    }

    const files = fs.readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    const existingMigrationsRes = await client.query('SELECT version FROM schema_migrations');
    const existingSet = new Set(existingMigrationsRes.rows.map((r: { version: string }) => r.version));

    for (const file of files) {
      if (existingSet.has(file)) {
        skipped.push(file);
        continue;
      }

      logger.info({ migration: file }, `Applying database migration: ${file}`);
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
      applied.push(file);
    }

    await client.query('COMMIT');
    logger.info({ appliedCount: applied.length, skippedCount: skipped.length }, 'Migration run completed');
    return { applied, skipped };
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error({ error: err instanceof Error ? err.message : String(err) }, 'Migration failed, transaction rolled back');
    throw err;
  } finally {
    client.release();
  }
}

// Allow direct execution
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runMigrations()
    .then((result) => {
      console.log('Migrations applied:', result.applied);
      console.log('Migrations skipped (already applied):', result.skipped);
      process.exit(0);
    })
    .catch((err) => {
      console.error('Migration execution failed:', err);
      process.exit(1);
    });
}

