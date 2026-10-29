import { describe, it, expect } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/pool.js';
import { config } from '../src/config/env.js';

describe('Integrations Management, Enrollment Lifecycle & Agent Security', () => {
  const app = createApp();

  const makeUser = async (roleLabel: string) => {
    const email = `integ_${roleLabel}_${crypto.randomBytes(4).toString('hex')}@example.com`;
    const password = 'Password123!';
    const regRes = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email,
        password,
        fullName: `Integration User ${roleLabel}`,
        workspaceName: `Workspace ${roleLabel}`,
      });

    const cookieHeader = regRes.headers['set-cookie'] as unknown as string[];
    const sessionCookie = cookieHeader
      .find((c: string) => c.startsWith(`${config.auth.sessionCookieName}=`))!
      .split(';')[0];

    // Mark user verified for authenticated operations
    await pool.query('UPDATE users SET is_verified = TRUE WHERE id = $1', [regRes.body.user.id]);

    return {
      userId: regRes.body.user.id as string,
      email,
      workspaceId: regRes.body.workspace.id as string,
      sessionCookie,
    };
  };

  const addMemberWithRole = async (
    ownerSessionCookie: string,
    workspaceId: string,
    memberEmail: string,
    role: 'admin' | 'analyst' | 'viewer'
  ) => {
    const res = await request(app)
      .post(`/api/v1/workspaces/${workspaceId}/members`)
      .set('Cookie', ownerSessionCookie)
      .send({ email: memberEmail, role });
    expect(res.status).toBe(201);
    return res.body;
  };

  it('allows an authorized user to create a linux_auth integration and validates input', async () => {
    const owner = await makeUser('Owner1');

    // 1. Rejects missing name
    const failMissing = await request(app)
      .post(`/api/v1/workspaces/${owner.workspaceId}/integrations`)
      .set('Cookie', owner.sessionCookie)
      .send({ integrationType: 'linux_auth' });
    expect(failMissing.status).toBe(400);
    expect(failMissing.body.message).toContain('name is required');

    // 2. Rejects unsupported integration type
    const failType = await request(app)
      .post(`/api/v1/workspaces/${owner.workspaceId}/integrations`)
      .set('Cookie', owner.sessionCookie)
      .send({ name: 'Windows DC', integrationType: 'windows_ad' });
    expect(failType.status).toBe(400);
    expect(failType.body.message).toContain('Unsupported integration type');

    // 3. Successfully creates a valid linux_auth integration
    const createRes = await request(app)
      .post(`/api/v1/workspaces/${owner.workspaceId}/integrations`)
      .set('Cookie', owner.sessionCookie)
      .send({
        name: 'Production Auth Gateway 01',
        integrationType: 'linux_auth',
        metadata: { environment: 'production', cloud: 'aws' },
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.status).toBe('created');
    expect(createRes.body.integration.name).toBe('Production Auth Gateway 01');
    expect(createRes.body.integration.integrationType).toBe('linux_auth');
    expect(createRes.body.integration.status).toBe('pending');
    expect(createRes.body.integration.workspaceId).toBe(owner.workspaceId);
    expect(createRes.body.integration.lastSeenAt).toBeNull();
    expect(createRes.body.integration.agentId).toBeNull();
  });

  it('enforces RBAC and strictly denies Viewer from creating or mutating integrations', async () => {
    const owner = await makeUser('RBAC_Owner');
    const viewer = await makeUser('RBAC_Viewer');
    const analyst = await makeUser('RBAC_Analyst');

    await addMemberWithRole(owner.sessionCookie, owner.workspaceId, viewer.email, 'viewer');
    await addMemberWithRole(owner.sessionCookie, owner.workspaceId, analyst.email, 'analyst');

    // 1. Viewer attempts to create integration -> 403 Forbidden
    const viewerCreate = await request(app)
      .post(`/api/v1/workspaces/${owner.workspaceId}/integrations`)
      .set('Cookie', viewer.sessionCookie)
      .send({ name: 'Viewer Server', integrationType: 'linux_auth' });
    expect(viewerCreate.status).toBe(403);
    expect(viewerCreate.body.message).toContain('analyst privileges');

    // 2. Analyst creates integration -> 201 Created
    const analystCreate = await request(app)
      .post(`/api/v1/workspaces/${owner.workspaceId}/integrations`)
      .set('Cookie', analyst.sessionCookie)
      .send({ name: 'Analyst Monitored Host', integrationType: 'linux_auth' });
    expect(analystCreate.status).toBe(201);
    const integrationId = analystCreate.body.integration.id;

    // 3. Viewer can read list and details
    const viewerList = await request(app)
      .get(`/api/v1/workspaces/${owner.workspaceId}/integrations`)
      .set('Cookie', viewer.sessionCookie);
    expect(viewerList.status).toBe(200);
    expect(viewerList.body.integrations.length).toBeGreaterThan(0);

    const viewerDetail = await request(app)
      .get(`/api/v1/workspaces/${owner.workspaceId}/integrations/${integrationId}`)
      .set('Cookie', viewer.sessionCookie);
    expect(viewerDetail.status).toBe(200);
    expect(viewerDetail.body.integration.id).toBe(integrationId);

    // 4. Viewer attempts to initiate enrollment -> 403 Forbidden
    const viewerEnroll = await request(app)
      .post(`/api/v1/workspaces/${owner.workspaceId}/integrations/${integrationId}/enrollment`)
      .set('Cookie', viewer.sessionCookie);
    expect(viewerEnroll.status).toBe(403);

    // 5. Viewer attempts to revoke credentials -> 403 Forbidden
    const viewerRevoke = await request(app)
      .post(`/api/v1/workspaces/${owner.workspaceId}/integrations/${integrationId}/revoke`)
      .set('Cookie', viewer.sessionCookie);
    expect(viewerRevoke.status).toBe(403);
  });

  it('enforces strict cross-workspace isolation on integrations and enrollment endpoints', async () => {
    const tenantA = await makeUser('TenantA');
    const tenantB = await makeUser('TenantB');

    // Tenant A creates integration
    const createRes = await request(app)
      .post(`/api/v1/workspaces/${tenantA.workspaceId}/integrations`)
      .set('Cookie', tenantA.sessionCookie)
      .send({ name: 'Tenant A Sensitive Bastion', integrationType: 'linux_auth' });
    expect(createRes.status).toBe(201);
    const integrationAId = createRes.body.integration.id;

    // Tenant B attempts to read Tenant A's integration -> 403 Forbidden (not a member of workspace A)
    const crossRead = await request(app)
      .get(`/api/v1/workspaces/${tenantA.workspaceId}/integrations/${integrationAId}`)
      .set('Cookie', tenantB.sessionCookie);
    expect(crossRead.status).toBe(403);

    // Tenant B attempts to read via their own workspace URL with Tenant A's ID -> 404 Not Found
    const idorRead = await request(app)
      .get(`/api/v1/workspaces/${tenantB.workspaceId}/integrations/${integrationAId}`)
      .set('Cookie', tenantB.sessionCookie);
    expect(idorRead.status).toBe(404);

    // Tenant B attempts to initiate enrollment on Tenant A's integration -> 404/403
    const crossEnroll = await request(app)
      .post(`/api/v1/workspaces/${tenantB.workspaceId}/integrations/${integrationAId}/enrollment`)
      .set('Cookie', tenantB.sessionCookie);
    expect(crossEnroll.status).toBe(404);

    // Tenant B's integration list does not contain Tenant A's resources
    const listB = await request(app)
      .get(`/api/v1/workspaces/${tenantB.workspaceId}/integrations`)
      .set('Cookie', tenantB.sessionCookie);
    expect(listB.status).toBe(200);
    const ids = listB.body.integrations.map((i: { id: string }) => i.id);
    expect(ids).not.toContain(integrationAId);
  });

  it('generates a cryptographically secure, single-use enrollment token and persists only its SHA-256 hash', async () => {
    const owner = await makeUser('CryptoOwner');

    const createRes = await request(app)
      .post(`/api/v1/workspaces/${owner.workspaceId}/integrations`)
      .set('Cookie', owner.sessionCookie)
      .send({ name: 'Ubuntu Host Alpha', integrationType: 'linux_auth' });
    const integrationId = createRes.body.integration.id;

    // Initiate enrollment
    const enrollRes = await request(app)
      .post(`/api/v1/workspaces/${owner.workspaceId}/integrations/${integrationId}/enrollment`)
      .set('Cookie', owner.sessionCookie);

    expect(enrollRes.status).toBe(201);
    const token = enrollRes.body.enrollment.enrollmentToken;
    expect(token).toBeDefined();
    expect(token.startsWith('sentinel_enroll_')).toBe(true);
    expect(token.length).toBeGreaterThan(40);
    expect(enrollRes.body.enrollment.expiresInSeconds).toBe(15 * 60);

    // Verify token is NOT stored as plaintext in database
    const dbTokens = await pool.query(
      'SELECT token_hash FROM enrollment_tokens WHERE integration_id = $1',
      [integrationId]
    );
    expect(dbTokens.rows.length).toBe(1);
    expect(dbTokens.rows[0].token_hash).not.toBe(token);

    // Verify SHA-256 match
    const computedHash = crypto.createHash('sha256').update(token).digest('hex');
    expect(dbTokens.rows[0].token_hash).toBe(computedHash);

    // Verify that ordinary detail and list endpoints NEVER reveal plaintext tokens or hashes
    const detailRes = await request(app)
      .get(`/api/v1/workspaces/${owner.workspaceId}/integrations/${integrationId}`)
      .set('Cookie', owner.sessionCookie);
    expect(detailRes.body.integration.hasActiveToken).toBe(true);
    expect(JSON.stringify(detailRes.body)).not.toContain(token);
    expect(JSON.stringify(detailRes.body)).not.toContain(computedHash);

    // Verify inspect enrollment state endpoint
    const stateRes = await request(app)
      .get(`/api/v1/workspaces/${owner.workspaceId}/integrations/${integrationId}/enrollment`)
      .set('Cookie', owner.sessionCookie);
    expect(stateRes.status).toBe(200);
    expect(stateRes.body.enrollment.hasActiveToken).toBe(true);
    expect(stateRes.body.enrollment.isEnrolled).toBe(false);
    expect(JSON.stringify(stateRes.body)).not.toContain(token);
  });

  it('completes the agent enrollment handshake atomically, issues agent credentials, and blocks replay', async () => {
    const owner = await makeUser('AgentHandshake');

    const intRes = await request(app)
      .post(`/api/v1/workspaces/${owner.workspaceId}/integrations`)
      .set('Cookie', owner.sessionCookie)
      .send({ name: 'Debian Database Node', integrationType: 'linux_auth' });
    const integrationId = intRes.body.integration.id;

    // 1. Generate enrollment token
    const tokenRes = await request(app)
      .post(`/api/v1/workspaces/${owner.workspaceId}/integrations/${integrationId}/enrollment`)
      .set('Cookie', owner.sessionCookie);
    const enrollmentToken = tokenRes.body.enrollment.enrollmentToken;

    // 2. Future Linux agent consumes token via public enrollment endpoint
    const agentExchangeRes = await request(app)
      .post('/api/v1/integrations/enroll')
      .send({
        enrollmentToken,
        agentMetadata: {
          hostname: 'db-node-01',
          os: 'Debian GNU/Linux 12 (bookworm)',
          arch: 'x86_64',
          agentVersion: '0.1.0',
        },
      });

    expect(agentExchangeRes.status).toBe(200);
    expect(agentExchangeRes.body.status).toBe('ok');
    const agentId = agentExchangeRes.body.agentId;
    const agentKey = agentExchangeRes.body.agentKey;
    expect(agentId).toBeDefined();
    expect(agentKey).toBeDefined();
    expect(agentKey.startsWith('sentinel_agent_')).toBe(true);

    // 3. Verify single-use: immediate replay attempt returns 401 Unauthorized
    const replayRes = await request(app)
      .post('/api/v1/integrations/enroll')
      .send({
        enrollmentToken,
        agentMetadata: { hostname: 'malicious-replay' },
      });
    expect(replayRes.status).toBe(401);
    expect(replayRes.body.message).toContain('Invalid, expired, or revoked enrollment token');

    // 4. Verify integration transitioned to 'connected' and agent credentials hashed in DB
    const detailAfter = await request(app)
      .get(`/api/v1/workspaces/${owner.workspaceId}/integrations/${integrationId}`)
      .set('Cookie', owner.sessionCookie);
    expect(detailAfter.body.integration.status).toBe('connected');
    expect(detailAfter.body.integration.agentId).toBe(agentId);
    expect(detailAfter.body.integration.lastSeenAt).not.toBeNull();

    // Verify agent credential is stored as SHA-256 hash
    const credRow = await pool.query(
      'SELECT credential_hash, is_revoked FROM agent_credentials WHERE agent_id = $1',
      [agentId]
    );
    expect(credRow.rows.length).toBe(1);
    expect(credRow.rows[0].is_revoked).toBe(false);
    expect(credRow.rows[0].credential_hash).not.toBe(agentKey);

    const expectedCredHash = crypto.createHash('sha256').update(agentKey).digest('hex');
    expect(credRow.rows[0].credential_hash).toBe(expectedCredHash);

    // 5. Agent authenticates and sends heartbeat using issued agent credentials
    const heartbeatRes = await request(app)
      .post('/api/v1/integrations/agent/heartbeat')
      .set('Authorization', `Bearer ${agentKey}`)
      .set('X-Agent-Id', agentId);
    expect(heartbeatRes.status).toBe(200);
    expect(heartbeatRes.body.message).toBe('Heartbeat acknowledged.');

    // 6. Invalid agent credentials fail authentication
    const badHeartbeat = await request(app)
      .post('/api/v1/integrations/agent/heartbeat')
      .set('Authorization', 'Bearer sentinel_agent_wrong_key')
      .set('X-Agent-Id', agentId);
    expect(badHeartbeat.status).toBe(401);
  });

  it('prevents race conditions with concurrent enrollment token consumption (exactly one success)', async () => {
    const owner = await makeUser('ConcurrencyOwner');

    const intRes = await request(app)
      .post(`/api/v1/workspaces/${owner.workspaceId}/integrations`)
      .set('Cookie', owner.sessionCookie)
      .send({ name: 'High-Concurrency Test Server', integrationType: 'linux_auth' });
    const integrationId = intRes.body.integration.id;

    const tokenRes = await request(app)
      .post(`/api/v1/workspaces/${owner.workspaceId}/integrations/${integrationId}/enrollment`)
      .set('Cookie', owner.sessionCookie);
    const enrollmentToken = tokenRes.body.enrollment.enrollmentToken;

    // Fire 5 concurrent requests with the identical token simultaneously
    const requests = Array.from({ length: 5 }, (_, i) =>
      request(app)
        .post('/api/v1/integrations/enroll')
        .send({
          enrollmentToken,
          agentMetadata: { hostname: `parallel-agent-${i}` },
        })
    );

    const results = await Promise.all(requests);
    const successes = results.filter((r) => r.status === 200);
    const failures = results.filter((r) => r.status === 401);

    expect(successes.length).toBe(1);
    expect(failures.length).toBe(4);
  });

  it('rejects expired enrollment tokens safely', async () => {
    const owner = await makeUser('ExpiredTokenOwner');

    const intRes = await request(app)
      .post(`/api/v1/workspaces/${owner.workspaceId}/integrations`)
      .set('Cookie', owner.sessionCookie)
      .send({ name: 'Expired Node', integrationType: 'linux_auth' });
    const integrationId = intRes.body.integration.id;

    const tokenRes = await request(app)
      .post(`/api/v1/workspaces/${owner.workspaceId}/integrations/${integrationId}/enrollment`)
      .set('Cookie', owner.sessionCookie);
    const enrollmentToken = tokenRes.body.enrollment.enrollmentToken;

    // Artificially expire the token in DB
    const tokenHash = crypto.createHash('sha256').update(enrollmentToken).digest('hex');
    await pool.query(
      "UPDATE enrollment_tokens SET expires_at = NOW() - INTERVAL '1 minute' WHERE token_hash = $1",
      [tokenHash]
    );

    const exchangeRes = await request(app)
      .post('/api/v1/integrations/enroll')
      .send({ enrollmentToken });

    expect(exchangeRes.status).toBe(401);
    expect(exchangeRes.body.message).toContain('Invalid, expired, or revoked');
  });

  it('revokes integration credentials immediately and blocks subsequent agent requests', async () => {
    const owner = await makeUser('RevokeOwner');

    const intRes = await request(app)
      .post(`/api/v1/workspaces/${owner.workspaceId}/integrations`)
      .set('Cookie', owner.sessionCookie)
      .send({ name: 'Compromised Node', integrationType: 'linux_auth' });
    const integrationId = intRes.body.integration.id;

    // Enroll agent
    const tokenRes = await request(app)
      .post(`/api/v1/workspaces/${owner.workspaceId}/integrations/${integrationId}/enrollment`)
      .set('Cookie', owner.sessionCookie);
    const enrollmentToken = tokenRes.body.enrollment.enrollmentToken;

    const agentExchange = await request(app)
      .post('/api/v1/integrations/enroll')
      .send({ enrollmentToken, agentMetadata: { hostname: 'node-to-revoke' } });
    const { agentId, agentKey } = agentExchange.body;

    // Verify heartbeat works before revocation
    const hbBefore = await request(app)
      .post('/api/v1/integrations/agent/heartbeat')
      .set('Authorization', `Bearer ${agentKey}`)
      .set('X-Agent-Id', agentId);
    expect(hbBefore.status).toBe(200);

    // Revoke integration credentials
    const revokeRes = await request(app)
      .post(`/api/v1/workspaces/${owner.workspaceId}/integrations/${integrationId}/revoke`)
      .set('Cookie', owner.sessionCookie);
    expect(revokeRes.status).toBe(200);
    expect(revokeRes.body.message).toContain('successfully revoked');

    // Subsequent heartbeat using the revoked agent credentials MUST fail
    const hbAfter = await request(app)
      .post('/api/v1/integrations/agent/heartbeat')
      .set('Authorization', `Bearer ${agentKey}`)
      .set('X-Agent-Id', agentId);
    expect(hbAfter.status).toBe(401);
    expect(hbAfter.body.message).toContain('Invalid or revoked');

    // Generating a new token on revoked integration is rejected
    const newEnrollRes = await request(app)
      .post(`/api/v1/workspaces/${owner.workspaceId}/integrations/${integrationId}/enrollment`)
      .set('Cookie', owner.sessionCookie);
    expect(newEnrollRes.status).toBe(400);
    expect(newEnrollRes.body.message).toContain('revoked');
  });

  it('records comprehensive, sanitized audit logs for all lifecycle and enrollment events', async () => {
    const owner = await makeUser('AuditOwner');

    const intRes = await request(app)
      .post(`/api/v1/workspaces/${owner.workspaceId}/integrations`)
      .set('Cookie', owner.sessionCookie)
      .send({ name: 'Audit Inspection Host', integrationType: 'linux_auth' });
    const integrationId = intRes.body.integration.id;

    // Generate token
    const tokenRes = await request(app)
      .post(`/api/v1/workspaces/${owner.workspaceId}/integrations/${integrationId}/enrollment`)
      .set('Cookie', owner.sessionCookie);
    const enrollmentToken = tokenRes.body.enrollment.enrollmentToken;

    // Consume token
    await request(app)
      .post('/api/v1/integrations/enroll')
      .send({ enrollmentToken });

    // Revoke
    await request(app)
      .post(`/api/v1/workspaces/${owner.workspaceId}/integrations/${integrationId}/revoke`)
      .set('Cookie', owner.sessionCookie);

    // Retrieve audit logs via detail endpoint
    const detailRes = await request(app)
      .get(`/api/v1/workspaces/${owner.workspaceId}/integrations/${integrationId}`)
      .set('Cookie', owner.sessionCookie);

    expect(detailRes.status).toBe(200);
    const auditLogs = detailRes.body.auditLogs;
    expect(auditLogs.length).toBeGreaterThanOrEqual(4);

    const actions = auditLogs.map((a: { action: string }) => a.action);
    expect(actions).toContain('integration_created');
    expect(actions).toContain('enrollment_initiated');
    expect(actions).toContain('enrollment_token_consumed');
    expect(actions).toContain('agent_credential_revoked');

    // CRITICAL: Ensure no plaintext secrets ever exist in audit log JSON
    const auditLogsJson = JSON.stringify(auditLogs);
    expect(auditLogsJson).not.toContain(enrollmentToken);
    expect(auditLogsJson).not.toContain('sentinel_agent_');
  });
});

