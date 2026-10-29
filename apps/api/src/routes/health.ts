import { Router, Request, Response } from 'express';
import { checkDatabaseConnection } from '../database/pool.js';

export const healthRouter = Router();

// Liveness probe: returns quickly to verify API process is healthy
healthRouter.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    service: 'sentinel-api',
  });
});

// Readiness probe: verifies downstream dependencies (PostgreSQL)
healthRouter.get('/ready', async (_req: Request, res: Response) => {
  const dbCheck = await checkDatabaseConnection(2000);

  if (!dbCheck.ok) {
    res.status(503).json({
      status: 'unavailable',
      checks: {
        database: 'failed',
      },
    });
    return;
  }

  res.status(200).json({
    status: 'ready',
    checks: {
      database: 'ok',
    },
  });
});

