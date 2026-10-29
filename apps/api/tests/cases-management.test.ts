import { describe, it, expect } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/pool.js';
import { config } from '../src/config/env.js';

describe('Investigation Case Management Verification', () => {
  const app = createApp();

  async function makeUserAndWorkspace(prefix: string, role: 'owner' | 'admin' | 'analyst' | 'viewer' = 'owner') {
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

  it('creates an investigation case from an alert, preserves alert link, supports idempotency, and lists cases', async () => {
    const { workspaceId, cookie, userId } = await makeUserAndWorkspace('case_mgr_a');

    // 1. Insert alert in workspace
    const fp = crypto.createHash('sha256').update(`alert_case_${Date.now()}`).digest('hex');
    const alertRes = await pool.query(
      `INSERT INTO alerts (
        workspace_id, rule_id, rule_version, rule_name, severity, status, title, summary, reason, fingerprint,
        first_event_at, last_event_at, event_count, metadata
      ) VALUES (
        $1, 'AUTH_REPEATED_FAILURES', '1.0.0', 'Repeated Auth Failures', 'high', 'open',
        'Brute Force on Bastion', 'Multiple failed attempts recorded', 'Exceeded 5 failures in 300s window',
        $2, NOW() - INTERVAL '10m', NOW(), 6, '{"target": "bastion-01"}'::jsonb
      ) RETURNING id;`,
      [workspaceId, fp]
    );
    const alertId = alertRes.rows[0].id;

    // 2. Create case from alert with idempotency key
    const idempotencyKey = `idem-${Date.now()}`;
    const createRes = await request(app)
      .post(`/api/v1/workspaces/${workspaceId}/cases`)
      .set('Cookie', cookie)
      .send({
        alertId,
        idempotencyKey,
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.status).toBe('ok');
    expect(createRes.body.case.id).toBeDefined();
    expect(createRes.body.case.title).toBe('Investigation: Brute Force on Bastion');
    expect(createRes.body.case.priority).toBe('high');
    expect(createRes.body.case.status).toBe('open');
    expect(createRes.body.case.source_alert_id).toBe(alertId);
    const caseId = createRes.body.case.id;

    // 3. Repeated submission with same idempotencyKey returns existing case safely
    const retryRes = await request(app)
      .post(`/api/v1/workspaces/${workspaceId}/cases`)
      .set('Cookie', cookie)
      .send({
        alertId,
        idempotencyKey,
      });
    expect(retryRes.status).toBe(200);
    expect(retryRes.body.case.id).toBe(caseId);

    // 4. Retrieve single case details
    const getRes = await request(app)
      .get(`/api/v1/workspaces/${workspaceId}/cases/${caseId}`)
      .set('Cookie', cookie);

    expect(getRes.status).toBe(200);
    expect(getRes.body.case.id).toBe(caseId);
    expect(getRes.body.case.linkedAlerts.length).toBe(1);
    expect(getRes.body.case.linkedAlerts[0].id).toBe(alertId);
    expect(getRes.body.case.linkedAlerts[0].ruleId).toBe('AUTH_REPEATED_FAILURES');
    expect(getRes.body.case.auditHistory.length).toBeGreaterThanOrEqual(1);

    // 5. List cases
    const listRes = await request(app)
      .get(`/api/v1/workspaces/${workspaceId}/cases?status=open`)
      .set('Cookie', cookie);

    expect(listRes.status).toBe(200);
    expect(listRes.body.total).toBe(1);
    expect(listRes.body.cases[0].id).toBe(caseId);
    expect(listRes.body.cases[0].alertCount).toBe(1);

    // 6. Test missing alert returns 404
    const badAlertRes = await request(app)
      .post(`/api/v1/workspaces/${workspaceId}/cases`)
      .set('Cookie', cookie)
      .send({
        alertId: '00000000-0000-0000-0000-000000000000',
      });
    expect(badAlertRes.status).toBe(404);

    // 7. Test missing title without alert returns 400
    const noTitleRes = await request(app)
      .post(`/api/v1/workspaces/${workspaceId}/cases`)
      .set('Cookie', cookie)
      .send({
        description: 'No title given',
      });
    expect(noTitleRes.status).toBe(400);
  });

  it('enforces tenant isolation and rejects cross-workspace case access', async () => {
    const wsA = await makeUserAndWorkspace('case_iso_a');
    const wsB = await makeUserAndWorkspace('case_iso_b');

    // Create case in Workspace A
    const createRes = await request(app)
      .post(`/api/v1/workspaces/${wsA.workspaceId}/cases`)
      .set('Cookie', wsA.cookie)
      .send({
        title: 'Confidential Investigation A',
        description: 'Workspace A internal finding',
      });
    expect(createRes.status).toBe(201);
    const caseId = createRes.body.case.id;

    // User B attempts to access Workspace A case details
    const crossRes = await request(app)
      .get(`/api/v1/workspaces/${wsB.workspaceId}/cases/${caseId}`)
      .set('Cookie', wsB.cookie);
    expect(crossRes.status).toBe(404);

    // User B attempts to list Workspace A cases
    const crossListRes = await request(app)
      .get(`/api/v1/workspaces/${wsA.workspaceId}/cases`)
      .set('Cookie', wsB.cookie);
    expect(crossListRes.status).toBe(403);
  });
});

