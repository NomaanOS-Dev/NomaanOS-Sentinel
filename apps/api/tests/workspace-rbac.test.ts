import { describe, it, expect } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/pool.js';
import { config } from '../src/config/env.js';

describe('Workspace Lifecycle, RBAC & Cross-Tenant Isolation', () => {
  const app = createApp();

  const makeUser = async (roleLabel: string) => {
    const email = `user_${roleLabel}_${crypto.randomBytes(4).toString('hex')}@example.com`;
    const password = 'Password123!';
    const regRes = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email,
        password,
        fullName: `User ${roleLabel}`,
        workspaceName: `Workspace of ${roleLabel}`,
      });

    const cookieHeader = regRes.headers['set-cookie'] as unknown as string[];
    const sessionCookie = cookieHeader.find((c: string) => c.startsWith(`${config.auth.sessionCookieName}=`))!.split(';')[0];

    // Mark verified in DB for test operations requiring verification
    await pool.query('UPDATE users SET is_verified = TRUE WHERE id = $1', [regRes.body.user.id]);

    return {
      userId: regRes.body.user.id as string,
      email,
      workspaceId: regRes.body.workspace.id as string,
      sessionCookie,
    };
  };

  it('enforces that workspace listing only returns member workspaces', async () => {
    const userA = await makeUser('A');
    const userB = await makeUser('B');

    const resA = await request(app)
      .get('/api/v1/workspaces')
      .set('Cookie', userA.sessionCookie);

    expect(resA.status).toBe(200);
    const wsIdsA = resA.body.workspaces.map((w: { id: string }) => w.id);
    expect(wsIdsA).toContain(userA.workspaceId);
    expect(wsIdsA).not.toContain(userB.workspaceId);
  });

  it('rejects access to another workspace by a non-member (403 Forbidden)', async () => {
    const userA = await makeUser('Alpha');
    const userB = await makeUser('Beta');

    const res = await request(app)
      .get(`/api/v1/workspaces/${userB.workspaceId}`)
      .set('Cookie', userA.sessionCookie);

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Forbidden');
    expect(res.body.message).toContain('not a member');
  });

  it('rejects invalid or malformed workspace UUIDs (400 Bad Request)', async () => {
    const userA = await makeUser('UUID_Test');

    const res = await request(app)
      .get('/api/v1/workspaces/not-a-valid-uuid')
      .set('Cookie', userA.sessionCookie);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Bad Request');
  });

  it('enforces RBAC: Owner adds an Analyst, Analyst cannot perform admin actions', async () => {
    const owner = await makeUser('Owner');
    const analystUser = await makeUser('AnalystCandidate');

    // 1. Owner adds candidate as 'analyst'
    const addRes = await request(app)
      .post(`/api/v1/workspaces/${owner.workspaceId}/members`)
      .set('Cookie', owner.sessionCookie)
      .send({
        email: analystUser.email,
        role: 'analyst',
      });

    expect(addRes.status).toBe(201);
    expect(addRes.body.member.role).toBe('analyst');

    // 2. Analyst attempts to add another member -> 403 Forbidden
    const randomUser = await makeUser('Random');
    const analystAddRes = await request(app)
      .post(`/api/v1/workspaces/${owner.workspaceId}/members`)
      .set('Cookie', analystUser.sessionCookie)
      .send({
        email: randomUser.email,
        role: 'viewer',
      });

    expect(analystAddRes.status).toBe(403);
    expect(analystAddRes.body.message).toContain('requires admin privileges');

    // 3. Analyst attempts to change a member's role -> 403 Forbidden
    const analystPatchRes = await request(app)
      .patch(`/api/v1/workspaces/${owner.workspaceId}/members/${owner.userId}`)
      .set('Cookie', analystUser.sessionCookie)
      .send({ role: 'viewer' });

    expect(analystPatchRes.status).toBe(403);

    // 4. Analyst attempts to delete a member -> 403 Forbidden
    const analystDeleteRes = await request(app)
      .delete(`/api/v1/workspaces/${owner.workspaceId}/members/${owner.userId}`)
      .set('Cookie', analystUser.sessionCookie);

    expect(analystDeleteRes.status).toBe(403);
  });

  it('enforces RBAC: Admin cannot demote or remove the Owner', async () => {
    const owner = await makeUser('CorpOwner');
    const adminUser = await makeUser('CorpAdmin');

    // Owner adds user as admin
    await request(app)
      .post(`/api/v1/workspaces/${owner.workspaceId}/members`)
      .set('Cookie', owner.sessionCookie)
      .send({
        email: adminUser.email,
        role: 'admin',
      });

    // Admin attempts to demote Owner to viewer -> 403 Forbidden
    const demoteRes = await request(app)
      .patch(`/api/v1/workspaces/${owner.workspaceId}/members/${owner.userId}`)
      .set('Cookie', adminUser.sessionCookie)
      .send({ role: 'viewer' });

    expect(demoteRes.status).toBe(403);
    expect(demoteRes.body.message).toContain('Admins cannot modify the role of a workspace owner');

    // Admin attempts to remove Owner -> 403 Forbidden
    const removeRes = await request(app)
      .delete(`/api/v1/workspaces/${owner.workspaceId}/members/${owner.userId}`)
      .set('Cookie', adminUser.sessionCookie);

    expect(removeRes.status).toBe(403);
    expect(removeRes.body.message).toContain('Admins cannot remove a workspace owner');
  });

  it('prevents users from changing their own role (privilege escalation prevention)', async () => {
    const owner = await makeUser('EscalationOwner');
    const adminUser = await makeUser('EscalationAdmin');

    await request(app)
      .post(`/api/v1/workspaces/${owner.workspaceId}/members`)
      .set('Cookie', owner.sessionCookie)
      .send({
        email: adminUser.email,
        role: 'admin',
      });

    // Admin tries to patch their own role to 'owner'
    const selfEscalateRes = await request(app)
      .patch(`/api/v1/workspaces/${owner.workspaceId}/members/${adminUser.userId}`)
      .set('Cookie', adminUser.sessionCookie)
      .send({ role: 'owner' });

    expect(selfEscalateRes.status).toBe(400);
    expect(selfEscalateRes.body.message).toContain('cannot change your own workspace role');
  });

  it('prevents demoting or removing the sole owner of a workspace', async () => {
    const owner = await makeUser('SoleOwner');
    const adminUser = await makeUser('SecondaryAdmin');

    await request(app)
      .post(`/api/v1/workspaces/${owner.workspaceId}/members`)
      .set('Cookie', owner.sessionCookie)
      .send({
        email: adminUser.email,
        role: 'admin',
      });

    // Attempting to demote sole owner to analyst
    const demoteRes = await request(app)
      .patch(`/api/v1/workspaces/${owner.workspaceId}/members/${owner.userId}`)
      .set('Cookie', owner.sessionCookie)
      .send({ role: 'analyst' });

    // Rejected because user cannot change their own role OR cannot demote sole owner
    expect(demoteRes.status).toBe(400);

    // Attempting to delete sole owner
    const deleteRes = await request(app)
      .delete(`/api/v1/workspaces/${owner.workspaceId}/members/${owner.userId}`)
      .set('Cookie', owner.sessionCookie);

    expect(deleteRes.status).toBe(400);
    expect(deleteRes.body.message).toContain('Cannot remove the sole owner');
  });

  it('CRITICAL: Enforces strict cross-workspace data isolation on security telemetry', async () => {
    const tenantA = await makeUser('TenantA');
    const tenantB = await makeUser('TenantB');

    const eventIdA = uuidv4();
    const eventIdB = uuidv4();

    // 1. Ingest event explicitly tagged to Tenant A's workspace
    await request(app)
      .post('/api/v1/events')
      .send({
        id: eventIdA,
        schema_version: '1.0.0',
        tenant_id: tenantA.workspaceId,
        source_type: 'linux_auth',
        source_host: 'bastion-corp-a',
        event_type: 'ssh_login_success',
        severity: 'info',
        occurred_at: new Date().toISOString(),
        observed_at: new Date().toISOString(),
        username: 'alice',
        source_ip: '192.0.2.11',
        message: 'Accepted publickey for alice',
        evidence: { raw_line: '...', line_number: 1 },
        ingestion_source: 'fixture_test',
      });

    // 2. Ingest event tagged to Tenant B's workspace
    await request(app)
      .post('/api/v1/events')
      .send({
        id: eventIdB,
        schema_version: '1.0.0',
        tenant_id: tenantB.workspaceId,
        source_type: 'linux_auth',
        source_host: 'bastion-corp-b',
        event_type: 'invalid_user_attempt',
        severity: 'medium',
        occurred_at: new Date().toISOString(),
        observed_at: new Date().toISOString(),
        username: 'intruder',
        source_ip: '203.0.113.99',
        message: 'Invalid user intruder',
        evidence: { raw_line: '...', line_number: 2 },
        ingestion_source: 'fixture_test',
      });

    // 3. Tenant A queries their workspace events: must see event A, must NOT see event B
    const eventsARes = await request(app)
      .get(`/api/v1/workspaces/${tenantA.workspaceId}/events`)
      .set('Cookie', tenantA.sessionCookie);

    expect(eventsARes.status).toBe(200);
    const returnedIdsA = eventsARes.body.events.map((e: { id: string }) => e.id);
    expect(returnedIdsA).toContain(eventIdA);
    expect(returnedIdsA).not.toContain(eventIdB);

    // 4. Tenant B queries their workspace events: must see event B, must NOT see event A
    const eventsBRes = await request(app)
      .get(`/api/v1/workspaces/${tenantB.workspaceId}/events`)
      .set('Cookie', tenantB.sessionCookie);

    expect(eventsBRes.status).toBe(200);
    const returnedIdsB = eventsBRes.body.events.map((e: { id: string }) => e.id);
    expect(returnedIdsB).toContain(eventIdB);
    expect(returnedIdsB).not.toContain(eventIdA);

    // 5. Tenant A attempts to access Tenant B's workspace events directly: 403 Forbidden!
    const crossAccessRes = await request(app)
      .get(`/api/v1/workspaces/${tenantB.workspaceId}/events`)
      .set('Cookie', tenantA.sessionCookie);

    expect(crossAccessRes.status).toBe(403);
    expect(crossAccessRes.body.error).toBe('Forbidden');
  });
});

