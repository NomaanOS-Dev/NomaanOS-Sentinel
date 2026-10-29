import { Request, Response, NextFunction } from 'express';
import { config } from '../config/env.js';

interface RateLimitRecord {
  count: number;
  resetAt: number;
}

const memoryStore = new Map<string, RateLimitRecord>();

// Clean up expired buckets periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of memoryStore.entries()) {
    if (record.resetAt <= now) {
      memoryStore.delete(key);
    }
  }
}, 60000).unref();

export function createRateLimiter(options: {
  windowMs: number;
  maxRequests: number;
  message?: string;
  forceEnableInTest?: boolean;
}) {
  const { windowMs, maxRequests, message = 'Too many requests. Please try again later.', forceEnableInTest = false } = options;

  return (req: Request, res: Response, next: NextFunction): void => {
    // Disable in test environment unless explicitly forced or header set
    if (config.nodeEnv === 'test' && !forceEnableInTest && req.headers['x-test-rate-limit'] !== 'true') {
      return next();
    }

    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
    const key = `${req.baseUrl || req.path}:${ip}`;
    const now = Date.now();

    let record = memoryStore.get(key);
    if (!record || record.resetAt <= now) {
      record = { count: 1, resetAt: now + windowMs };
      memoryStore.set(key, record);
    } else {
      record.count += 1;
    }

    res.setHeader('RateLimit-Limit', maxRequests);
    res.setHeader('RateLimit-Remaining', Math.max(0, maxRequests - record.count));
    res.setHeader('RateLimit-Reset', Math.ceil(record.resetAt / 1000));

    if (record.count > maxRequests) {
      res.status(429).json({
        error: 'Too Many Requests',
        message,
        retryAfterSeconds: Math.ceil((record.resetAt - now) / 1000),
      });
      return;
    }

    next();
  };
}

export const authRateLimiter = createRateLimiter({
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 15,
  message: 'Too many authentication attempts. Please try again shortly.',
});

export const passwordResetRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 5,
  message: 'Too many password reset requests. Please try again shortly.',
});

export const aiInvestigationRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: config.ai.rateLimitPerMinute || 10,
  message: 'Too many AI investigation requests. Please wait a minute before requesting another analysis.',
});


