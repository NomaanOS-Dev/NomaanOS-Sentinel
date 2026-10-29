import { createApp } from './app.js';
import { config } from './config/env.js';
import { logger } from './config/logger.js';
import { pool } from './database/pool.js';
import { datasetWorker } from './services/dataset-worker.js';

const app = createApp();

const server = app.listen(config.port, () => {
  logger.info({
    port: config.port,
    environment: config.nodeEnv,
    logLevel: config.logLevel,
  }, `NomaanOS Sentinel API listening on port ${config.port}`);

  // Start background processing worker
  datasetWorker.start();
});

// Graceful shutdown handling
function gracefulShutdown(signal: string) {
  logger.info({ signal }, `Received ${signal}, initiating graceful shutdown`);
  datasetWorker.stop();

  server.close(async () => {
    logger.info('HTTP server closed');
    try {
      await pool.end();
      logger.info('Database pool drained successfully');
      process.exit(0);
    } catch (err) {
      logger.error({ error: err instanceof Error ? err.message : String(err) }, 'Error draining database pool');
      process.exit(1);
    }
  });

  // Force close if graceful shutdown exceeds 5 seconds
  setTimeout(() => {
    logger.warn('Forced shutdown due to timeout');
    process.exit(1);
  }, 5000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

