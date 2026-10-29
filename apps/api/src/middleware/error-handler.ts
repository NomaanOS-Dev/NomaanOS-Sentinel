import { Request, Response, NextFunction } from 'express';
import { logger } from '../config/logger.js';
import { config } from '../config/env.js';

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  next: NextFunction
): void {
  const requestId = req.headers['x-request-id'] as string;
  
  // Sanitize message: never reveal connection strings or raw SQL error secrets
  const sanitizedMessage = err.message
    .replace(/postgresql:\/\/[^@]+@/gi, 'postgresql://[REDACTED]@')
    .replace(/password=[^\s;]+/gi, 'password=[REDACTED]');

  logger.error({
    requestId,
    error: err.name,
    message: sanitizedMessage,
    path: req.originalUrl,
    method: req.method,
    stack: config.isProduction ? undefined : err.stack,
  }, 'Unhandled request error');

  if (res.headersSent) {
    return;
  }

  // Handle Plan Quota and Entitlement Errors
  if ((err as any).code === 'QUOTA_EXCEEDED') {
    const qErr = err as any;
    res.status(qErr.statusCode || 402).json({
      error: 'QUOTA_EXCEEDED',
      message: qErr.message,
      quotaType: qErr.quotaType,
      limit: qErr.limit,
      currentUsage: qErr.currentUsage,
      planId: qErr.planId,
      upgradeRequired: qErr.upgradeRequired,
      requestId,
    });
    return;
  }

  res.status(500).json({
    error: 'Internal Server Error',
    message: config.isProduction ? 'An unexpected error occurred.' : sanitizedMessage,
    requestId,
  });
}

