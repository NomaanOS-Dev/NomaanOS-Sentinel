import { describe, it, expect } from 'vitest';
import { sanitizeObject } from '../src/config/logger.js';

describe('Structured Logging Redaction', () => {
  it('redacts sensitive fields in nested payloads', () => {
    const rawData = {
      username: 'analyst_01',
      password: 'super_secret_password_123',
      nested: {
        api_key: 'sk-1234567890abcdef',
        token: 'jwt.token.here',
        database_url: 'postgresql://admin:secret@db:5432/db',
        safeProperty: 'normal_value',
      },
      tags: ['auth', 'linux'],
    };

    const sanitized = sanitizeObject(rawData) as Record<string, unknown>;

    expect(sanitized.username).toBe('analyst_01');
    expect(sanitized.password).toBe('[REDACTED]');

    const nested = sanitized.nested as Record<string, unknown>;
    expect(nested.api_key).toBe('[REDACTED]');
    expect(nested.token).toBe('[REDACTED]');
    expect(nested.database_url).toBe('[REDACTED]');
    expect(nested.safeProperty).toBe('normal_value');
    expect(sanitized.tags).toEqual(['auth', 'linux']);
  });
});

