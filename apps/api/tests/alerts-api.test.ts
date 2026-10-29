import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/pool.js';
import { config } from '../src/config/env.js';

describe('Alerts API & Evidence Navigation Verification', () => {
  const app = createApp();

  async function makeUserAndWorkspace(prefix: string) {
    const email = `${prefix}_${crypto.randomBytes(4).toString('hex')}@example.com`;
    const regRes = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email,
        password: 'Password123!',
        fullName: 'Alerts Tester',
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

  it('lists alerts, retrieves details with evidence events, updates status, and enforces RBAC and tenant isolation', async () => {
    const ownerA = await makeUserAndWorkspace('alert_owner_a');
    const ownerB = await makeUserAndWorkspace('alert_owner_b');

    // 1. Insert a security event in Workspace A
    const eventRes = await pool.query(
      `INSERT INTO security_events (
        tenant_id, source_type, source_host, event_type, severity, occurred_at, username, source_ip, message, evidence, ingestion_source
      ) VALUES ($1, 'linux_auth', 'server-01', 'ssh_login_failure', 'medium', NOW(), 'root', '198.51.100.1', 'Failed root login', '{}'::jsonb, 'test')
      RETURNING id;`,
      [ownerA.workspaceId]
    );
    const eventId = eventRes.rows[0].id;

    // 2. Insert an alert in Workspace A
    const fingerprint = crypto.createHash('sha256').update(`test_fingerprint_${Date.now()}`).digest('hex');
    const alertRes = await pool.query(
      `INSERT INTO alerts (
        workspace_id, rule_id, rule_version, rule_name, severity, status, title, summary, reason, fingerprint, first_event_at, last_event_at, event_count, metadata
      ) VALUES (
        $1, 'AUTH_REPEATED_FAILURES', '1.0.0', 'Repeated Authentication Failures', 'medium', 'open',
        'Repeated failures for root', 'Observed 5 failures for root', 'Multiple failed attempts from 198.51.100.1',
        $2, NOW() - INTERVAL '2 minutes', NOW(), 1, '{"username": "root"}'::jsonb
      ) RETURNING id;`,
      [ownerA.workspaceId, fingerprint]
    );
    const alertId = alertRes.rows[0].id;

    // 3. Link alert to security event in alert_events
    await pool.query(
      `INSERT INTO alert_events (alert_id, event_id, role) VALUES ($1, $2, 'supporting');`,
      [alertId, eventId]
    );

    // 4. List alerts for Workspace A
    const listRes = await request(app)
      .get(`/api/v1/workspaces/${ownerA.workspaceId}/alerts`)
      .set('Cookie', ownerA.cookie);

    expect(listRes.status).toBe(200);
    expect(listRes.body.total).toBe(1);
    expect(listRes.body.alerts.length).toBe(1);
    expect(listRes.body.alerts[0].id).toBe(alertId);
    expect(listRes.body.alerts[0].ruleId).toBe('AUTH_REPEATED_FAILURES');
    expect(listRes.body.alerts[0].severity).toBe('medium');
    expect(listRes.body.alerts[0].status).toBe('open');

    // 5. Test filtering by severity and status
    const filterRes = await request(app)
      .get(`/api/v1/workspaces/${ownerA.workspaceId}/alerts?severity=high`)
      .set('Cookie', ownerA.cookie);
    expect(filterRes.status).toBe(200);
    expect(filterRes.body.total).toBe(0);

    const matchFilterRes = await request(app)
      .get(`/api/v1/workspaces/${ownerA.workspaceId}/alerts?severity=medium&status=open`)
      .set('Cookie', ownerA.cookie);
    expect(matchFilterRes.status).toBe(200);
    expect(matchFilterRes.body.total).toBe(1);

    // 6. Retrieve single alert details with evidence navigation
    const detailRes = await request(app)
      .get(`/api/v1/workspaces/${ownerA.workspaceId}/alerts/${alertId}`)
      .set('Cookie', ownerA.cookie);

    expect(detailRes.status).toBe(200);
    expect(detailRes.body.alert).toBeDefined();
    expect(detailRes.body.alert.id).toBe(alertId);
    expect(detailRes.body.alert.evidenceEvents).toBeDefined();
    expect(detailRes.body.alert.evidenceEvents.length).toBe(1);
    expect(detailRes.body.alert.evidenceEvents[0].eventId).toBe(eventId);
    expect(detailRes.body.alert.evidenceEvents[0].eventType).toBe('ssh_login_failure');
    expect(detailRes.body.alert.evidenceEvents[0].role).toBe('supporting');

    // 7. Update alert status (analyst/admin)
    const patchRes = await request(app)
      .patch(`/api/v1/workspaces/${ownerA.workspaceId}/alerts/${alertId}/status`)
      .set('Cookie', ownerA.cookie)
      .send({ status: 'acknowledged' });

    expect(patchRes.status).toBe(200);
    expect(patchRes.body.alert.status).toBe('acknowledged');

    // 8. Reject invalid status
    const badStatusRes = await request(app)
      .patch(`/api/v1/workspaces/${ownerA.workspaceId}/alerts/${alertId}/status`)
      .set('Cookie', ownerA.cookie)
      .send({ status: 'invalid_status' });
    expect(badStatusRes.status).toBe(400);

    // 9. Enforce Tenant Isolation: Workspace B cannot see or modify Workspace A alert
    const crossListRes = await request(app)
      .get(`/api/v1/workspaces/${ownerB.workspaceId}/alerts`)
      .set('Cookie', ownerB.cookie);
    expect(crossListRes.status).toBe(200);
    expect(crossListRes.body.total).toBe(0);

    const crossGetRes = await request(app)
      .get(`/api/v1/workspaces/${ownerB.workspaceId}/alerts/${alertId}`)
      .set('Cookie', ownerB.cookie);
    expect(crossGetRes.status).toBe(404);

    const crossPatchRes = await request(app)
      .patch(`/api/v1/workspaces/${ownerB.workspaceId}/alerts/${alertId}/status`)
      .set('Cookie', ownerB.cookie)
      .send({ status: 'resolved' });
    expect(crossPatchRes.status).toBe(404);
  });
});

