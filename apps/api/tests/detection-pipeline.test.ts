import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/pool.js';
import { datasetWorker } from '../src/services/dataset-worker.js';
import { config } from '../src/config/env.js';

describe('End-to-End Detection Pipeline & Idempotent Reprocessing', () => {
  const app = createApp();

  beforeAll(() => {
    datasetWorker.start();
  });

  afterAll(() => {
    datasetWorker.stop();
  });

  async function makeUserAndWorkspace(prefix: string) {
    const email = `${prefix}_${crypto.randomBytes(4).toString('hex')}@example.com`;
    const regRes = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email,
        password: 'Password123!',
        fullName: 'Pipeline Tester',
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

  it('uploads telemetry, executes detection rules, persists evidence-linked alerts, and guarantees idempotent reprocessing', async () => {
    const { cookie, workspaceId } = await makeUserAndWorkspace('detect_pipe');

    // Synthetic log telemetry:
    // - 5 SSH failures for target_user from 198.51.100.77 within 2 minutes (Rule A: AUTH_REPEATED_FAILURES)
    // - 1 sudo command execution by admin_user (Rule C: PRIV_ACCOUNT_ACTIVITY)
    const logContent = [
      'Oct 24 10:00:01 test-host sshd[1001]: Failed password for target_user from 198.51.100.77 port 4001 ssh2',
      'Oct 24 10:00:15 test-host sshd[1002]: Failed password for target_user from 198.51.100.77 port 4002 ssh2',
      'Oct 24 10:00:30 test-host sshd[1003]: Failed password for target_user from 198.51.100.77 port 4003 ssh2',
      'Oct 24 10:00:45 test-host sshd[1004]: Failed password for target_user from 198.51.100.77 port 4004 ssh2',
      'Oct 24 10:01:00 test-host sshd[1005]: Failed password for target_user from 198.51.100.77 port 4005 ssh2',
      'Oct 24 10:02:00 test-host sudo: admin_user : TTY=pts/1 ; PWD=/home/admin_user ; USER=root ; COMMAND=/bin/cat /etc/shadow',
    ].join('\n');

    // 1. Upload dataset
    const uploadRes = await request(app)
      .post(`/api/v1/workspaces/${workspaceId}/datasets`)
      .set('Cookie', cookie)
      .attach('file', Buffer.from(logContent, 'utf-8'), 'incident-telemetry.log');

    expect(uploadRes.status).toBe(201);
    const datasetId = uploadRes.body.dataset.id;

    // Trigger worker tick
    datasetWorker.triggerImmediate();

    // 2. Poll until dataset status is completed
    let completed = false;
    for (let i = 0; i < 25; i++) {
      await new Promise((r) => setTimeout(r, 200));
      const dsRes = await request(app)
        .get(`/api/v1/workspaces/${workspaceId}/datasets/${datasetId}`)
        .set('Cookie', cookie);

      if (dsRes.body.dataset?.status === 'completed') {
        completed = true;
        expect(dsRes.body.dataset.validLines).toBe(6);
        break;
      }
    }
    expect(completed).toBe(true);

    // 3. Retrieve generated alerts via workspace alerts API
    const alertsRes = await request(app)
      .get(`/api/v1/workspaces/${workspaceId}/alerts`)
      .set('Cookie', cookie);

    expect(alertsRes.status).toBe(200);
    expect(alertsRes.body.total).toBe(2);
    expect(alertsRes.body.alerts.length).toBe(2);

    const ruleIds = alertsRes.body.alerts.map((a: any) => a.ruleId);
    expect(ruleIds).toContain('AUTH_REPEATED_FAILURES');
    expect(ruleIds).toContain('PRIV_ACCOUNT_ACTIVITY');

    // Verify Rule A alert
    const bruteAlert = alertsRes.body.alerts.find((a: any) => a.ruleId === 'AUTH_REPEATED_FAILURES');
    expect(bruteAlert).toBeDefined();
    expect(bruteAlert.severity).toBe('medium');
    expect(bruteAlert.eventCount).toBe(5);
    expect(bruteAlert.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(bruteAlert.reason).toContain('target_user');
    expect(bruteAlert.reason).toContain('198.51.100.77');

    // Verify Rule C alert
    const privAlert = alertsRes.body.alerts.find((a: any) => a.ruleId === 'PRIV_ACCOUNT_ACTIVITY');
    expect(privAlert).toBeDefined();
    expect(privAlert.severity).toBe('medium');
    expect(privAlert.eventCount).toBe(1);
    expect(privAlert.reason).toContain('sudo');

    // 4. Retrieve single alert details and verify evidence events navigation
    const detailRes = await request(app)
      .get(`/api/v1/workspaces/${workspaceId}/alerts/${bruteAlert.id}`)
      .set('Cookie', cookie);

    expect(detailRes.status).toBe(200);
    expect(detailRes.body.alert.evidenceEvents.length).toBe(5);

    // Verify every supporting event actually exists in security_events table
    for (const evLink of detailRes.body.alert.evidenceEvents) {
      expect(evLink.eventId).toBeDefined();
      expect(evLink.eventType).toBe('ssh_login_failure');
      expect(evLink.username).toBe('target_user');
      expect(evLink.sourceIp).toBe('198.51.100.77');

      const dbEventRes = await pool.query('SELECT id, tenant_id FROM security_events WHERE id = $1', [evLink.eventId]);
      expect(dbEventRes.rows.length).toBe(1);
      expect(dbEventRes.rows[0].tenant_id).toBe(workspaceId);
    }

    // 5. Reprocessing Idempotency Test:
    // Evaluate events again or reprocess without duplicating alerts
    const dbEventsRes = await pool.query(
      'SELECT id, schema_version, tenant_id, source_type, source_host, event_type, severity, occurred_at, observed_at, username, source_ip, source_port, process_name, message, evidence, ingestion_source FROM security_events WHERE dataset_id = $1',
      [datasetId]
    );
    expect(dbEventsRes.rows.length).toBe(6);

    // Call detection runner directly with already persisted events
    const { detectionRunner } = await import('../src/services/detection-runner.js');
    await detectionRunner.runAndPersistDetections(workspaceId, datasetId, dbEventsRes.rows);

    // Verify alert count remains exactly 2 (no duplicate alerts created!)
    const afterReprocessRes = await request(app)
      .get(`/api/v1/workspaces/${workspaceId}/alerts`)
      .set('Cookie', cookie);

    expect(afterReprocessRes.status).toBe(200);
    expect(afterReprocessRes.body.total).toBe(2);
    expect(afterReprocessRes.body.alerts.length).toBe(2);

    // 6. Tenant Isolation:
    // A second workspace cannot access workspace A alerts or events
    const otherUser = await makeUserAndWorkspace('isolated_user');
    const otherAlertsRes = await request(app)
      .get(`/api/v1/workspaces/${otherUser.workspaceId}/alerts`)
      .set('Cookie', otherUser.cookie);

    expect(otherAlertsRes.status).toBe(200);
    expect(otherAlertsRes.body.total).toBe(0);

    const crossGetRes = await request(app)
      .get(`/api/v1/workspaces/${otherUser.workspaceId}/alerts/${bruteAlert.id}`)
      .set('Cookie', otherUser.cookie);
    expect(crossGetRes.status).toBe(404);
  });
});

