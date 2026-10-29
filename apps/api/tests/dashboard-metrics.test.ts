import { describe, it, expect } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/pool.js';
import { config } from '../src/config/env.js';

describe('Workspace Dashboard Overview Metrics Verification', () => {
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

  it('returns zero counts and empty arrays for a fresh workspace without data', async () => {
    const { workspaceId, cookie } = await makeUserAndWorkspace('dash_empty');

    const res = await request(app)
      .get(`/api/v1/workspaces/${workspaceId}/dashboard`)
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.workspaceId).toBe(workspaceId);

    // Alerts metrics
    expect(res.body.metrics.alerts.total).toBe(0);
    expect(res.body.metrics.alerts.bySeverity).toEqual({
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      info: 0,
    });
    expect(res.body.metrics.alerts.byStatus).toEqual({
      open: 0,
      acknowledged: 0,
      resolved: 0,
      dismissed: 0,
    });

    // Events metrics
    expect(res.body.metrics.events.total).toBe(0);
    expect(res.body.metrics.events.bySeverity).toEqual({
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      info: 0,
    });

    // Datasets metrics
    expect(res.body.metrics.datasets.total).toBe(0);
    expect(res.body.metrics.datasets.byStatus).toEqual({
      completed: 0,
      failed: 0,
      processing: 0,
      queued: 0,
    });

    expect(res.body.recentAlerts).toEqual([]);
    expect(res.body.recentEvents).toEqual([]);
  });

  it('aggregates alerts, events, datasets, and recent records accurately for a populated workspace', async () => {
    const { workspaceId, cookie, userId } = await makeUserAndWorkspace('dash_populated');

    // 1. Insert datasets
    const kPrefix = crypto.randomBytes(6).toString('hex');
    await pool.query(
      `INSERT INTO datasets (
        workspace_id, created_by, original_filename, file_size_bytes, file_sha256, storage_key, status
      ) VALUES 
        ($1, $2, 'auth1.log', 1024, 'sha1', $3, 'completed'),
        ($1, $2, 'auth2.log', 2048, 'sha2', $4, 'completed'),
        ($1, $2, 'auth3.log', 512, 'sha3', $5, 'failed');`,
      [workspaceId, userId, `${kPrefix}_1`, `${kPrefix}_2`, `${kPrefix}_3`]
    );

    // 2. Insert security events with different severities
    const now = new Date();
    await pool.query(
      `INSERT INTO security_events (
        tenant_id, source_type, source_host, event_type, severity, occurred_at, username, source_ip, message, evidence, ingestion_source
      ) VALUES
        ($1, 'linux_auth', 'srv-1', 'ssh_login_success', 'info', $2, 'alice', '10.0.0.1', 'Accepted password', '{}'::jsonb, 'test'),
        ($1, 'linux_auth', 'srv-1', 'ssh_login_failure', 'medium', $3, 'bob', '10.0.0.2', 'Failed password', '{}'::jsonb, 'test'),
        ($1, 'linux_auth', 'srv-2', 'user_auth_failed', 'high', $4, 'root', '10.0.0.3', 'Root auth failure', '{}'::jsonb, 'test'),
        ($1, 'linux_auth', 'srv-2', 'privilege_escalation', 'critical', $5, 'root', '10.0.0.4', 'Sudo to root', '{}'::jsonb, 'test');`,
      [
        workspaceId,
        new Date(now.getTime() - 4000).toISOString(),
        new Date(now.getTime() - 3000).toISOString(),
        new Date(now.getTime() - 2000).toISOString(),
        new Date(now.getTime() - 1000).toISOString(),
      ]
    );

    // 3. Insert alerts with different severities and statuses
    const fp1 = crypto.createHash('sha256').update(`dash_fp1_${Date.now()}`).digest('hex');
    const fp2 = crypto.createHash('sha256').update(`dash_fp2_${Date.now()}`).digest('hex');
    const fp3 = crypto.createHash('sha256').update(`dash_fp3_${Date.now()}`).digest('hex');

    await pool.query(
      `INSERT INTO alerts (
        workspace_id, rule_id, rule_version, rule_name, severity, status, title, summary, reason, fingerprint, first_event_at, last_event_at, event_count, metadata
      ) VALUES
        ($1, 'AUTH_REPEATED_FAILURES', '1.0.0', 'Repeated Auth Failures', 'medium', 'open', 'Alert 1', 'Summary 1', 'Reason 1', $2, NOW() - INTERVAL '5m', NOW(), 5, '{}'::jsonb),
        ($1, 'AUTH_SUCCESS_AFTER_FAILURES', '1.0.0', 'Success After Failures', 'high', 'acknowledged', 'Alert 2', 'Summary 2', 'Reason 2', $3, NOW() - INTERVAL '4m', NOW(), 4, '{}'::jsonb),
        ($1, 'PRIV_ACCOUNT_ACTIVITY', '1.0.0', 'Privileged Activity', 'critical', 'resolved', 'Alert 3', 'Summary 3', 'Reason 3', $4, NOW() - INTERVAL '3m', NOW(), 1, '{}'::jsonb);`,
      [workspaceId, fp1, fp2, fp3]
    );

    const res = await request(app)
      .get(`/api/v1/workspaces/${workspaceId}/dashboard`)
      .set('Cookie', cookie);

    expect(res.status).toBe(200);

    // Alerts metrics check
    expect(res.body.metrics.alerts.total).toBe(3);
    expect(res.body.metrics.alerts.bySeverity).toEqual({
      critical: 1,
      high: 1,
      medium: 1,
      low: 0,
      info: 0,
    });
    expect(res.body.metrics.alerts.byStatus).toEqual({
      open: 1,
      acknowledged: 1,
      resolved: 1,
      dismissed: 0,
    });

    // Events metrics check
    expect(res.body.metrics.events.total).toBe(4);
    expect(res.body.metrics.events.bySeverity).toEqual({
      critical: 1,
      high: 1,
      medium: 1,
      low: 0,
      info: 1,
    });

    // Datasets metrics check
    expect(res.body.metrics.datasets.total).toBe(3);
    expect(res.body.metrics.datasets.byStatus).toEqual({
      completed: 2,
      failed: 1,
      processing: 0,
      queued: 0,
    });

    // Recent items check
    expect(res.body.recentAlerts.length).toBe(3);
    expect(res.body.recentEvents.length).toBe(4);

    // Recent events ordering (newest occurred_at first)
    expect(res.body.recentEvents[0].username).toBe('root');
    expect(res.body.recentEvents[0].severity).toBe('critical');
    expect(res.body.recentEvents[3].username).toBe('alice');
    expect(res.body.recentEvents[3].severity).toBe('info');
  });

  it('strictly isolates dashboard telemetry across workspaces and blocks unauthorized users', async () => {
    const wsA = await makeUserAndWorkspace('dash_iso_a');
    const wsB = await makeUserAndWorkspace('dash_iso_b');

    // Insert an alert in Workspace A only
    const fp = crypto.createHash('sha256').update(`dash_iso_${Date.now()}`).digest('hex');
    await pool.query(
      `INSERT INTO alerts (
        workspace_id, rule_id, rule_version, rule_name, severity, status, title, summary, reason, fingerprint, first_event_at, last_event_at, event_count, metadata
      ) VALUES
        ($1, 'AUTH_REPEATED_FAILURES', '1.0.0', 'Repeated Auth Failures', 'high', 'open', 'Isolated Alert', 'Summary', 'Reason', $2, NOW(), NOW(), 1, '{}'::jsonb);`,
      [wsA.workspaceId, fp]
    );

    // User A can access Workspace A dashboard
    const resA = await request(app)
      .get(`/api/v1/workspaces/${wsA.workspaceId}/dashboard`)
      .set('Cookie', wsA.cookie);
    expect(resA.status).toBe(200);
    expect(resA.body.metrics.alerts.total).toBe(1);

    // User B querying Workspace B sees 0 alerts
    const resB = await request(app)
      .get(`/api/v1/workspaces/${wsB.workspaceId}/dashboard`)
      .set('Cookie', wsB.cookie);
    expect(resB.status).toBe(200);
    expect(resB.body.metrics.alerts.total).toBe(0);

    // IDOR check: User B attempts to access Workspace A dashboard
    const crossRes = await request(app)
      .get(`/api/v1/workspaces/${wsA.workspaceId}/dashboard`)
      .set('Cookie', wsB.cookie);
    expect(crossRes.status).toBe(403);
    expect(crossRes.body.error).toBe('Forbidden');

    // Unauthenticated check
    const unauthRes = await request(app)
      .get(`/api/v1/workspaces/${wsA.workspaceId}/dashboard`);
    expect(unauthRes.status).toBe(401);
  });
});
