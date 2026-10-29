import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import * as poolModule from '../src/database/pool.js';

describe('Health and Readiness Endpoints', () => {
  const app = createApp();

  it('GET /health returns 200 with service status', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: 'ok',
      service: 'sentinel-api',
    });
    expect(res.headers['x-request-id']).toBeDefined();
  });

  it('GET /ready returns 200 when database connection is healthy', async () => {
    vi.spyOn(poolModule, 'checkDatabaseConnection').mockResolvedValueOnce({
      ok: true,
      latencyMs: 3,
    });

    const res = await request(app).get('/ready');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: 'ready',
      checks: {
        database: 'ok',
      },
    });
  });

  it('GET /ready returns 503 when database connection is unavailable', async () => {
    vi.spyOn(poolModule, 'checkDatabaseConnection').mockResolvedValueOnce({
      ok: false,
      error: 'Connection refused',
    });

    const res = await request(app).get('/ready');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({
      status: 'unavailable',
      checks: {
        database: 'failed',
      },
    });
    // Ensure no sensitive connection strings or errors are exposed
    expect(JSON.stringify(res.body)).not.toContain('Connection refused');
  });
});

