import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/pool.js';
import { datasetWorker } from '../src/services/dataset-worker.js';
import { config } from '../src/config/env.js';

describe('Comprehensive End-to-End Detection Engine Verification', () => {
  const app = createApp();

  beforeAll(() => {
    datasetWorker.start();
  });

  afterAll(() => {
    datasetWorker.stop();
  });

  async function registerAndVerifyUser(emailPrefix: string) {
    const email = `${emailPrefix}_${crypto.randomBytes(4).toString('hex')}@example.com`;
    const regRes = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email,
        password: 'Password123!',
        fullName: 'E2E Detection Auditor',
        workspaceName: `${emailPrefix} Organization`,
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

  it('demonstrates end-to-end pipeline: upload -> parse -> persist -> detect -> alerts -> evidence linking -> deduplication', async () => {
    const primaryTenant = await registerAndVerifyUser('e2e_primary');
    const foreignTenant = await registerAndVerifyUser('e2e_foreign');

    // Controlled synthetic telemetry exercising all 4 rules:
    // 1. charlie: 5 failures -> AUTH_REPEATED_FAILURES
    // 2. david: 3 failures + 1 success -> AUTH_SUCCESS_AFTER_FAILURES
    // 3. root login from 203.0.113.50 -> PRIV_ACCOUNT_ACTIVITY (high)
    // 4. operator sudo cat /etc/shadow -> PRIV_ACCOUNT_ACTIVITY (medium)
    // 5. invalid users probe from 198.51.100.99 -> AUTH_INVALID_USER_PROBING
    const syntheticTelemetry = [
      // Rule A: Repeated Failures for charlie
      'Oct 24 11:00:01 test-host sshd[2001]: Failed password for charlie from 198.51.100.42 port 5001 ssh2',
      'Oct 24 11:00:15 test-host sshd[2002]: Failed password for charlie from 198.51.100.42 port 5002 ssh2',
      'Oct 24 11:00:30 test-host sshd[2003]: Failed password for charlie from 198.51.100.42 port 5003 ssh2',
      'Oct 24 11:00:45 test-host sshd[2004]: Failed password for charlie from 198.51.100.42 port 5004 ssh2',
      'Oct 24 11:01:00 test-host sshd[2005]: Failed password for charlie from 198.51.100.42 port 5005 ssh2',

      // Rule B: Failures followed by success for david
      'Oct 24 11:02:00 test-host sshd[2010]: Failed password for david from 198.51.100.88 port 5010 ssh2',
      'Oct 24 11:02:30 test-host sshd[2011]: Failed password for david from 198.51.100.88 port 5011 ssh2',
      'Oct 24 11:03:00 test-host sshd[2012]: Failed password for david from 198.51.100.88 port 5012 ssh2',
      'Oct 24 11:03:20 test-host sshd[2013]: Accepted password for david from 198.51.100.88 port 5013 ssh2',

      // Rule C: Privileged actions (root SSH and sudo execution)
      'Oct 24 11:04:00 test-host sshd[2020]: Accepted password for root from 203.0.113.50 port 5020 ssh2',
      'Oct 24 11:05:00 test-host sudo: operator : TTY=pts/2 ; PWD=/home/operator ; USER=root ; COMMAND=/bin/cat /etc/shadow',

      // Rule D: Invalid user probing from single IP
      'Oct 24 11:06:00 test-host sshd[2030]: Invalid user testuser1 from 198.51.100.99 port 5030',
      'Oct 24 11:06:10 test-host sshd[2031]: Invalid user oracle from 198.51.100.99 port 5031',
      'Oct 24 11:06:20 test-host sshd[2032]: Invalid user guest from 198.51.100.99 port 5032',
    ].join('\n');

    // Step 1: Upload dataset
    const uploadRes = await request(app)
      .post(`/api/v1/workspaces/${primaryTenant.workspaceId}/datasets`)
      .set('Cookie', primaryTenant.cookie)
      .attach('file', Buffer.from(syntheticTelemetry, 'utf-8'), 'security-incident.log');

    expect(uploadRes.status).toBe(201);
    const datasetId = uploadRes.body.dataset.id;
    expect(uploadRes.body.dataset.status).toBe('queued');

    // Trigger worker tick
    datasetWorker.triggerImmediate();

    // Step 2 & 3: Wait for parser to process & persist canonical events
    let completed = false;
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 200));
      const dsRes = await request(app)
        .get(`/api/v1/workspaces/${primaryTenant.workspaceId}/datasets/${datasetId}`)
        .set('Cookie', primaryTenant.cookie);

      if (dsRes.body.dataset?.status === 'completed') {
        completed = true;
        // Total 14 lines parsed and validated
        expect(dsRes.body.dataset.validLines).toBe(14);
        expect(dsRes.body.dataset.totalLines).toBe(14);
        break;
      }
    }
    expect(completed).toBe(true);

    // Verify 14 events persisted in security_events table for this workspace
    const dbEventsRes = await pool.query(
      'SELECT id, event_type, username, source_ip FROM security_events WHERE dataset_id = $1 AND tenant_id = $2',
      [datasetId, primaryTenant.workspaceId]
    );
    expect(dbEventsRes.rows.length).toBe(14);

    // Step 4 & 5: Verify expected alerts are generated
    const alertsRes = await request(app)
      .get(`/api/v1/workspaces/${primaryTenant.workspaceId}/alerts`)
      .set('Cookie', primaryTenant.cookie);

    expect(alertsRes.status).toBe(200);
    expect(alertsRes.body.total).toBe(5);
    expect(alertsRes.body.alerts.length).toBe(5);

    const generatedAlerts = alertsRes.body.alerts;
    const ruleIds = generatedAlerts.map((a: any) => a.ruleId);
    expect(ruleIds).toContain('AUTH_REPEATED_FAILURES');
    expect(ruleIds).toContain('AUTH_SUCCESS_AFTER_FAILURES');
    expect(ruleIds).toContain('PRIV_ACCOUNT_ACTIVITY');
    expect(ruleIds).toContain('AUTH_INVALID_USER_PROBING');

    // Step 6: Verify every alert links to actual supporting event IDs
    for (const alt of generatedAlerts) {
      expect(alt.fingerprint).toMatch(/^[a-f0-9]{64}$/);
      expect(alt.ruleVersion).toBe('1.0.0');

      const detailRes = await request(app)
        .get(`/api/v1/workspaces/${primaryTenant.workspaceId}/alerts/${alt.id}`)
        .set('Cookie', primaryTenant.cookie);

      expect(detailRes.status).toBe(200);
      const evidenceEvents = detailRes.body.alert.evidenceEvents;
      expect(evidenceEvents.length).toBeGreaterThanOrEqual(1);

      // Verify each event exists in database with matching tenant_id
      for (const ev of evidenceEvents) {
        const verifyDb = await pool.query(
          'SELECT id, tenant_id FROM security_events WHERE id = $1',
          [ev.eventId]
        );
        expect(verifyDb.rows.length).toBe(1);
        expect(verifyDb.rows[0].tenant_id).toBe(primaryTenant.workspaceId);
      }
    }

    // Step 7: Reprocessing Idempotency
    // Reprocessing the dataset or re-evaluating events must not create duplicate alerts
    const { detectionRunner } = await import('../src/services/detection-runner.js');
    await detectionRunner.runAndPersistDetections(
      primaryTenant.workspaceId,
      datasetId,
      dbEventsRes.rows
    );

    const recheckAlertsRes = await request(app)
      .get(`/api/v1/workspaces/${primaryTenant.workspaceId}/alerts`)
      .set('Cookie', primaryTenant.cookie);

    expect(recheckAlertsRes.status).toBe(200);
    // Count MUST remain exactly 5
    expect(recheckAlertsRes.body.total).toBe(5);
    expect(recheckAlertsRes.body.alerts.length).toBe(5);

    // Step 8: Multi-tenant isolation verification
    // Foreign tenant must see 0 alerts and receive 404 on attempt to access primary alerts
    const foreignAlertsRes = await request(app)
      .get(`/api/v1/workspaces/${foreignTenant.workspaceId}/alerts`)
      .set('Cookie', foreignTenant.cookie);

    expect(foreignAlertsRes.status).toBe(200);
    expect(foreignAlertsRes.body.total).toBe(0);

    const firstPrimaryAlertId = generatedAlerts[0].id;
    const crossAccessRes = await request(app)
      .get(`/api/v1/workspaces/${foreignTenant.workspaceId}/alerts/${firstPrimaryAlertId}`)
      .set('Cookie', foreignTenant.cookie);

    expect(crossAccessRes.status).toBe(404);
  });
});

