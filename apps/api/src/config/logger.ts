import pino from 'pino';
import { config } from './env.js';

const SENSITIVE_KEYS = [
  'password',
  'secret',
  'token',
  'authorization',
  'cookie',
  'set-cookie',
  'database_url',
  'apikey',
  'api_key',
];

export const logger = pino({
  name: 'sentinel-api',
  level: config.logLevel,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["set-cookie"]',
      'password',
      '*.password',
      'password_hash',
      '*.password_hash',
      'secret',
      '*.secret',
      'token',
      '*.token',
      'token_hash',
      '*.token_hash',
      'session_token',
      '*.session_token',
      'databaseUrl',
      'connectionString',
    ],
    censor: '[REDACTED]',
  },
  formatters: {
    level: (label) => ({ level: label }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export function sanitizeObject(obj: unknown): unknown {
  if (!obj || typeof obj !== 'object') {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(sanitizeObject);
  }
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const lowerKey = key.toLowerCase();
    if (SENSITIVE_KEYS.some((sensitive) => lowerKey.includes(sensitive))) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeObject(value);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

