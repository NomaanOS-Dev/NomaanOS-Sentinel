import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../config/logger.js';

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const correlationId = (req.headers['x-request-id'] as string) || uuidv4();
  req.headers['x-request-id'] = correlationId;
  res.setHeader('x-request-id', correlationId);

  const startTime = Date.now();
  const { method, originalUrl } = req;

  res.on('finish', () => {
    const durationMs = Date.now() - startTime;
    const statusCode = res.statusCode;

    logger.info({
      requestId: correlationId,
      method,
      url: originalUrl,
      statusCode,
      durationMs,
      userAgent: req.headers['user-agent'],
    }, `${method} ${originalUrl} ${statusCode} (${durationMs}ms)`);
  });

  next();
}

