import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { v4 as uuidv4 } from 'uuid';

describe('API Integration with Live Database', () => {
  const app = createApp();

  it('GET /ready returns 200 with database ok on live postgres', async () => {
    const res = await request(app).get('/ready');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: 'ready',
      checks: {
        database: 'ok',
      },
    });
  });

  it('POST /api/v1/events ingests a valid event and GET /api/v1/events retrieves it', async () => {
    const eventId = uuidv4();
    const testEvent = {
      id: eventId,
      schema_version: '1.0.0',
      source_type: 'linux_auth',
      source_host: 'server-prod-01',
      event_type: 'ssh_login_success',
      severity: 'info',
      occurred_at: new Date().toISOString(),
      observed_at: new Date().toISOString(),
      username: 'devops_admin',
      source_ip: '198.51.100.12',
      source_port: 48211,
      process_name: 'sshd',
      message: 'Accepted publickey for devops_admin from 198.51.100.12 port 48211 ssh2',
      evidence: {
        auth_method: 'publickey',
        fingerprint: 'SHA256:7mPq...',
      },
      ingestion_source: 'fixture_test',
    };

    const postRes = await request(app)
      .post('/api/v1/events')
      .send(testEvent);

    expect(postRes.status).toBe(201);
    expect(postRes.body.status).toBe('created');
    expect(postRes.body.event.id).toBe(eventId);

    const getRes = await request(app)
      .get(`/api/v1/events?event_type=ssh_login_success`);

    expect(getRes.status).toBe(200);
    expect(getRes.body.total).toBeGreaterThanOrEqual(1);
    const found = getRes.body.events.find((e: { id: string }) => e.id === eventId);
    expect(found).toBeDefined();
    expect(found.username).toBe('devops_admin');
  });
});

