import { describe, it, expect } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/pool.js';
import { config } from '../src/config/env.js';

describe('Alert Investigation Flow Verification', () => {
  const app = createApp();

  async function makeUserAndWorkspace(prefix: string) {
    const email = `${prefix}_${crypto.randomBytes(4).toString('hex')}@example.com`;
    const regRes = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email,
        password: 'Password123!',
        fullName: `${prefix} User`,
        workspaceName: `${prefix} Workspace`,
      });
    expect(regRes.status).toBe(201);

    const cookieHeader = regRes.headers['set-cookie'] as unknown as string[];
    const sessionCookie = cookieHeader
      .find((c: string) => c.startsWith(`${config.auth.sessionCookieName}=`))!
      .split(';')[0];
    const workspaceId = regRes.body.workspace.id as string;
    const userId = regRes.body.user.id as string;

    await pool.query('UPDATE users SET is_verified = TRUE WHERE id = $1', [userId]);

    return { userId, cookie: sessionCookie, workspaceId };
  }

  it('supports time-range & rule alert filtering, evidence linking, and status updates with strict RBAC', async () => {
    const { workspaceId, cookie, userId } = await makeUserAndWorkspace('alt_flow_owner');

    // 1. Create a member with 'viewer' role to test RBAC restrictions
    const viewerEmail = `viewer_${crypto.randomBytes(4).toString('hex')}@example.com`;
    const vRegRes = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: viewerEmail,
        password: 'Password123!',
        fullName: 'Viewer User',
        workspaceName: 'Viewer WS',
      });
    const vUserId = vRegRes.body.user.id;
    await pool.query('UPDATE users SET is_verified = TRUE WHERE id = $1', [vUserId]);
    const vCookieHeader = vRegRes.headers['set-cookie'] as unknown as string[];
    const viewerCookie = vCookieHeader
      .find((c: string) => c.startsWith(`${config.auth.sessionCookieName}=`))!
      .split(';')[0];

    // Add viewer to the first workspace
    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, 'viewer');`,
      [workspaceId, vUserId]
    );

    // 2. Insert security events
    const ev1Res = await pool.query(
      `INSERT INTO security_events (
        tenant_id, source_type, source_host, event_type, severity, occurred_at, username, source_ip, message, evidence, ingestion_source
      ) VALUES ($1, 'linux_auth', 'auth-gw', 'ssh_login_failure', 'medium', NOW() - INTERVAL '10 minutes', 'admin', '192.168.1.100', 'Auth failed', '{}'::jsonb, 'test')
      RETURNING id;`,
      [workspaceId]
    );
    const ev1Id = ev1Res.rows[0].id;

    const ev2Res = await pool.query(
      `INSERT INTO security_events (
        tenant_id, source_type, source_host, event_type, severity, occurred_at, username, source_ip, message, evidence, ingestion_source
      ) VALUES ($1, 'linux_auth', 'auth-gw', 'ssh_login_success', 'info', NOW() - INTERVAL '2 minutes', 'admin', '192.168.1.100', 'Auth success', '{}'::jsonb, 'test')
      RETURNING id;`,
      [workspaceId]
    );
    const ev2Id = ev2Res.rows[0].id;

    // 3. Insert alerts at distinct times
    const fp1 = crypto.createHash('sha256').update(`alt_flow_1_${Date.now()}`).digest('hex');
    const fp2 = crypto.createHash('sha256').update(`alt_flow_2_${Date.now()}`).digest('hex');

    const a1Res = await pool.query(
      `INSERT INTO alerts (
        workspace_id, rule_id, rule_version, rule_name, severity, status, title, summary, reason, fingerprint,
        first_event_at, last_event_at, event_count, metadata, created_at
      ) VALUES (
        $1, 'AUTH_REPEATED_FAILURES', '1.0.0', 'Repeated Auth Failures', 'medium', 'open',
        'Multiple failures for admin', '5 failures recorded', 'Brute force pattern detected',
        $2, NOW() - INTERVAL '10m', NOW() - INTERVAL '8m', 5, '{"ip": "192.168.1.100"}'::jsonb,
        NOW() - INTERVAL '8m'
      ) RETURNING id;`,
      [workspaceId, fp1]
    );
    const a1Id = a1Res.rows[0].id;

    const a2Res = await pool.query(
      `INSERT INTO alerts (
        workspace_id, rule_id, rule_version, rule_name, severity, status, title, summary, reason, fingerprint,
        first_event_at, last_event_at, event_count, metadata, created_at
      ) VALUES (
        $1, 'AUTH_SUCCESS_AFTER_FAILURES', '1.0.0', 'Success After Failures', 'high', 'open',
        'Success after repeated failures for admin', 'Failures followed by success', 'Potential brute force success',
        $2, NOW() - INTERVAL '7m', NOW() - INTERVAL '2m', 6, '{"ip": "192.168.1.100"}'::jsonb,
        NOW() - INTERVAL '2m'
      ) RETURNING id;`,
      [workspaceId, fp2]
    );
    const a2Id = a2Res.rows[0].id;

    // Link evidence events
    await pool.query(
      `INSERT INTO alert_events (alert_id, event_id, role) VALUES 
        ($1, $2, 'trigger'),
        ($3, $2, 'supporting'),
        ($3, $4, 'trigger');`,
      [a1Id, ev1Id, a2Id, ev2Id]
    );

    // 4. Test Alert Listing with rule filter
    const ruleRes = await request(app)
      .get(`/api/v1/workspaces/${workspaceId}/alerts?rule_id=AUTH_REPEATED_FAILURES`)
      .set('Cookie', cookie);
    expect(ruleRes.status).toBe(200);
    expect(ruleRes.body.total).toBe(1);
    expect(ruleRes.body.alerts[0].id).toBe(a1Id);

    // 5. Test Alert Listing with time range (from, to)
    const fromTime = new Date(Date.now() - 5 * 60 * 1000).toISOString(); // 5 min ago
    const toTime = new Date(Date.now() + 1 * 60 * 1000).toISOString();
    const timeFilterRes = await request(app)
      .get(`/api/v1/workspaces/${workspaceId}/alerts?from=${encodeURIComponent(fromTime)}&to=${encodeURIComponent(toTime)}`)
      .set('Cookie', cookie);
    expect(timeFilterRes.status).toBe(200);
    expect(timeFilterRes.body.total).toBe(1);
    expect(timeFilterRes.body.alerts[0].id).toBe(a2Id);

    // 6. Test Alert Detail & Evidence Navigation
    const detailRes = await request(app)
      .get(`/api/v1/workspaces/${workspaceId}/alerts/${a2Id}`)
      .set('Cookie', cookie);
    expect(detailRes.status).toBe(200);
    expect(detailRes.body.alert.id).toBe(a2Id);
    expect(detailRes.body.alert.ruleId).toBe('AUTH_SUCCESS_AFTER_FAILURES');
    expect(detailRes.body.alert.evidenceEvents.length).toBe(2);
    expect(detailRes.body.alert.evidenceEvents.map((e: any) => e.role)).toEqual(['supporting', 'trigger']);
    expect(detailRes.body.alert.evidenceEvents[0].eventId).toBe(ev1Id);
    expect(detailRes.body.alert.evidenceEvents[1].eventId).toBe(ev2Id);

    // 7. Test Alert Status Updating
    // Viewer should be forbidden (403)
    const viewerPatchRes = await request(app)
      .patch(`/api/v1/workspaces/${workspaceId}/alerts/${a2Id}/status`)
      .set('Cookie', viewerCookie)
      .send({ status: 'acknowledged' });
    expect(viewerPatchRes.status).toBe(403);

    // Invalid status should return 400
    const badStatusRes = await request(app)
      .patch(`/api/v1/workspaces/${workspaceId}/alerts/${a2Id}/status`)
      .set('Cookie', cookie)
      .send({ status: 'invalid_status_state' });
    expect(badStatusRes.status).toBe(400);

    // Owner (manager) can update status to acknowledged
    const ackRes = await request(app)
      .patch(`/api/v1/workspaces/${workspaceId}/alerts/${a2Id}/status`)
      .set('Cookie', cookie)
      .send({ status: 'acknowledged' });
    expect(ackRes.status).toBe(200);
    expect(ackRes.body.alert.status).toBe('acknowledged');

    // And then to resolved
    const resRes = await request(app)
      .patch(`/api/v1/workspaces/${workspaceId}/alerts/${a2Id}/status`)
      .set('Cookie', cookie)
      .send({ status: 'resolved' });
    expect(resRes.status).toBe(200);
    expect(resRes.body.alert.status).toBe('resolved');
  });
});

