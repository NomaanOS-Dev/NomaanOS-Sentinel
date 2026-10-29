import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/pool.js';

const app = createApp();

interface RegisterUserResponse {
  user: { id: string; email: string };
  verificationToken?: string;
}

async function createVerifiedUserAndWorkspace(label: string) {
  const email = `agent_test_${label}_${crypto.randomBytes(4).toString('hex')}@example.com`;
  const password = 'Password123!Secure';

  const regRes = await request(app)
    .post('/api/v1/auth/register')
    .send({ email, password, fullName: `Agent Test ${label}` });

  expect(regRes.status).toBe(201);
  const { user } = regRes.body as RegisterUserResponse;

  // Verify email directly in DB
  await pool.query('UPDATE users SET is_verified = TRUE WHERE id = $1', [user.id]);

  // Login
  const loginRes = await request(app)
    .post('/api/v1/auth/login')
    .send({ email, password });

  expect(loginRes.status).toBe(200);
  const cookie = loginRes.headers['set-cookie'] as unknown as string[];

  // Create Workspace
  const wsRes = await request(app)
    .post('/api/v1/workspaces')
    .set('Cookie', cookie)
    .send({ name: `Agent Test Workspace ${label}` });

  expect(wsRes.status).toBe(201);
  const workspaceId = wsRes.body.workspace.id;

  return { email, password, userId: user.id, cookie, workspaceId };
}

describe('Linux Agent Batch Ingestion Endpoint (/api/v1/integrations/agent/events)', () => {
  let context: Awaited<ReturnType<typeof createVerifiedUserAndWorkspace>>;
  let integrationId: string;
  let agentId: string;
  let agentKey: string;

  beforeEach(async () => {
    context = await createVerifiedUserAndWorkspace('batch');

    // 1. Create integration
    const intRes = await request(app)
      .post(`/api/v1/workspaces/${context.workspaceId}/integrations`)
      .set('Cookie', context.cookie)
      .send({
        name: 'Production Auth Server 01',
        integrationType: 'linux_auth',
        metadata: { hostname: 'ubuntu-prod-01' },
      });

    expect(intRes.status).toBe(201);
    integrationId = intRes.body.integration.id;

    // 2. Generate single-use enrollment token
    const tokenRes = await request(app)
      .post(`/api/v1/workspaces/${context.workspaceId}/integrations/${integrationId}/enrollment`)
      .set('Cookie', context.cookie);

    expect(tokenRes.status).toBe(201);
    const enrollmentToken = tokenRes.body.enrollment.enrollmentToken;

    // 3. Consume token to obtain agent credentials
    const enrollRes = await request(app)
      .post('/api/v1/integrations/enroll')
      .send({
        enrollmentToken,
        agentMetadata: { hostname: 'ubuntu-prod-01', os: 'Ubuntu 24.04 LTS' },
      });

    expect(enrollRes.status).toBe(200);
    agentId = enrollRes.body.agentId;
    agentKey = enrollRes.body.agentKey;
  });

  it('successfully ingests valid normalized batch and updates integration state', async () => {
    const eventId1 = crypto.randomUUID();
    const eventId2 = crypto.randomUUID();
    const batchId = crypto.randomUUID();

    const payload = {
      batchId,
      events: [
        {
          id: eventId1,
          schema_version: '1.0.0',
          source_type: 'linux_auth',
          source_host: 'ubuntu-prod-01',
          event_type: 'ssh_login_success',
          severity: 'info',
          occurred_at: '2026-10-27T10:00:00Z',
          observed_at: '2026-10-27T10:00:01Z',
          username: 'ubuntu',
          source_ip: '192.168.1.50',
          source_port: 54321,
          process_name: 'sshd',
          message: 'Accepted publickey for ubuntu from 192.168.1.50 port 54321 ssh2',
          evidence: { raw_line: 'Accepted publickey for ubuntu...', auth_method: 'publickey' },
          ingestion_source: 'linux_agent',
        },
        {
          id: eventId2,
          schema_version: '1.0.0',
          source_type: 'linux_auth',
          source_host: 'ubuntu-prod-01',
          event_type: 'sudo_execution',
          severity: 'low',
          occurred_at: '2026-10-27T10:01:00Z',
          observed_at: '2026-10-27T10:01:01Z',
          username: 'ubuntu',
          process_name: 'sudo',
          message: 'ubuntu : TTY=pts/0 ; PWD=/home/ubuntu ; USER=root ; COMMAND=/usr/bin/apt update',
          evidence: { raw_line: 'sudo command...' },
          ingestion_source: 'linux_agent',
        },
      ],
    };

    const res = await request(app)
      .post('/api/v1/integrations/agent/events')
      .set('Authorization', `Bearer ${agentKey}`)
      .set('X-Agent-Id', agentId)
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.batchId).toBe(batchId);
    expect(res.body.acceptedCount).toBe(2);

    // Verify events in database with proper workspace isolation
    const dbEvents = await pool.query(
      'SELECT id, tenant_id, ingestion_source, event_type, username FROM security_events WHERE id IN ($1, $2) ORDER BY occurred_at ASC',
      [eventId1, eventId2]
    );

    expect(dbEvents.rows.length).toBe(2);
    expect(dbEvents.rows[0].tenant_id).toBe(context.workspaceId);
    expect(dbEvents.rows[0].ingestion_source).toBe('linux_agent');
    expect(dbEvents.rows[0].username).toBe('ubuntu');

    // Verify integration status transitioned to connected
    const intDb = await pool.query('SELECT status, last_seen_at FROM integrations WHERE id = $1', [integrationId]);
    expect(intDb.rows[0].status).toBe('connected');
    expect(intDb.rows[0].last_seen_at).toBeTruthy();
  });

  it('guarantees idempotency on retried batches using ON CONFLICT DO NOTHING', async () => {
    const eventId = crypto.randomUUID();
    const batchId = crypto.randomUUID();

    const payload = {
      batchId,
      events: [
        {
          id: eventId,
          schema_version: '1.0.0',
          source_type: 'linux_auth',
          source_host: 'ubuntu-prod-01',
          event_type: 'session_opened',
          severity: 'info',
          occurred_at: '2026-10-27T10:05:00Z',
          message: 'pam_unix(sshd:session): session opened for user ubuntu by (uid=0)',
          evidence: {},
          ingestion_source: 'linux_agent',
        },
      ],
    };

    // First attempt
    const res1 = await request(app)
      .post('/api/v1/integrations/agent/events')
      .set('Authorization', `Bearer ${agentKey}`)
      .set('X-Agent-Id', agentId)
      .send(payload);

    expect(res1.status).toBe(200);
    expect(res1.body.acceptedCount).toBe(1);

    // Second attempt (simulating client retry after network blip)
    const res2 = await request(app)
      .post('/api/v1/integrations/agent/events')
      .set('Authorization', `Bearer ${agentKey}`)
      .set('X-Agent-Id', agentId)
      .send(payload);

    expect(res2.status).toBe(200);
    expect(res2.body.acceptedCount).toBe(1);

    // Only one row should exist
    const countRes = await pool.query('SELECT COUNT(*) FROM security_events WHERE id = $1', [eventId]);
    expect(parseInt(countRes.rows[0].count, 10)).toBe(1);
  });

  it('rejects unauthenticated and revoked requests with 401', async () => {
    const payload = {
      events: [
        {
          id: crypto.randomUUID(),
          source_type: 'linux_auth',
          event_type: 'ssh_login_success',
          severity: 'info',
          occurred_at: new Date().toISOString(),
          message: 'test',
          evidence: {},
        },
      ],
    };

    // Missing auth
    const resNoAuth = await request(app)
      .post('/api/v1/integrations/agent/events')
      .send(payload);
    expect(resNoAuth.status).toBe(401);

    // Invalid agent key
    const resBadKey = await request(app)
      .post('/api/v1/integrations/agent/events')
      .set('Authorization', 'Bearer invalid_wrong_key')
      .set('X-Agent-Id', agentId)
      .send(payload);
    expect(resBadKey.status).toBe(401);

    // Revoke integration
    await request(app)
      .post(`/api/v1/workspaces/${context.workspaceId}/integrations/${integrationId}/revoke`)
      .set('Cookie', context.cookie);

    // Attempt with revoked credentials
    const resRevoked = await request(app)
      .post('/api/v1/integrations/agent/events')
      .set('Authorization', `Bearer ${agentKey}`)
      .set('X-Agent-Id', agentId)
      .send(payload);

    expect(resRevoked.status).toBe(401);
    expect(resRevoked.body.message).toContain('revoked');
  });

  it('rejects malformed events failing canonical schema with 422', async () => {
    const payload = {
      events: [
        {
          id: crypto.randomUUID(),
          source_type: 'invalid_source_type_never_allowed', // Invalid source type
          event_type: 'ssh_login_success',
          severity: 'info',
          occurred_at: '2026-10-27T10:00:00Z',
          message: 'test',
          evidence: {},
        },
      ],
    };

    const res = await request(app)
      .post('/api/v1/integrations/agent/events')
      .set('Authorization', `Bearer ${agentKey}`)
      .set('X-Agent-Id', agentId)
      .send(payload);

    expect(res.status).toBe(422);
    expect(res.body.error).toBe('SCHEMA_VALIDATION_ERROR');
    expect(res.body.details).toBeInstanceOf(Array);
  });

  it('rejects empty batches and oversized batches with 400', async () => {
    // Empty array
    const resEmpty = await request(app)
      .post('/api/v1/integrations/agent/events')
      .set('Authorization', `Bearer ${agentKey}`)
      .set('X-Agent-Id', agentId)
      .send({ events: [] });

    expect(resEmpty.status).toBe(400);

    // > 100 events
    const oversized = Array.from({ length: 101 }, () => ({
      id: crypto.randomUUID(),
      source_type: 'linux_auth',
      event_type: 'ssh_login_success',
      severity: 'info',
      occurred_at: new Date().toISOString(),
      message: 'test',
      evidence: {},
    }));

    const resOversized = await request(app)
      .post('/api/v1/integrations/agent/events')
      .set('Authorization', `Bearer ${agentKey}`)
      .set('X-Agent-Id', agentId)
      .send({ events: oversized });

    expect(resOversized.status).toBe(400);
    expect(resOversized.body.message).toContain('100');
  });

  it('triggers deterministic detections on ingested brute-force events', async () => {
    // Generate 6 consecutive SSH login failures from same IP to trigger brute-force alert rule
    const attackerIp = '203.0.113.88';
    const baseTime = new Date('2026-10-27T10:30:00Z').getTime();

    const bruteForceEvents = Array.from({ length: 6 }, (_, i) => ({
      id: crypto.randomUUID(),
      schema_version: '1.0.0',
      source_type: 'linux_auth',
      source_host: 'ubuntu-prod-01',
      event_type: 'ssh_login_failure',
      severity: 'low',
      occurred_at: new Date(baseTime + i * 5000).toISOString(),
      username: 'root',
      source_ip: attackerIp,
      source_port: 40000 + i,
      process_name: 'sshd',
      message: `Failed password for root from ${attackerIp} port ${40000 + i} ssh2`,
      evidence: { raw_line: `Failed password for root from ${attackerIp}` },
      ingestion_source: 'linux_agent',
    }));

    const res = await request(app)
      .post('/api/v1/integrations/agent/events')
      .set('Authorization', `Bearer ${agentKey}`)
      .set('X-Agent-Id', agentId)
      .send({ events: bruteForceEvents });

    expect(res.status).toBe(200);
    expect(res.body.acceptedCount).toBe(6);
    expect(res.body.alertsGenerated).toBeGreaterThanOrEqual(1);

    // Verify alert is queryable in workspace alerts
    const alertsRes = await request(app)
      .get(`/api/v1/workspaces/${context.workspaceId}/alerts`)
      .set('Cookie', context.cookie);

    expect(alertsRes.status).toBe(200);
    expect(alertsRes.body.alerts.length).toBeGreaterThanOrEqual(1);
    const bfAlert = alertsRes.body.alerts.find(
      (a: { ruleId: string }) => a.ruleId === 'AUTH_REPEATED_FAILURES'
    );
    expect(bfAlert).toBeDefined();
    expect(bfAlert.summary).toContain(attackerIp);
    expect(bfAlert.fingerprint).toHaveLength(64);
  });
});
