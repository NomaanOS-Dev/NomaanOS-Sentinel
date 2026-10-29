import { describe, it, expect } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/pool.js';
import { config } from '../src/config/env.js';

describe('Investigation Case Reporting & Export Verification', () => {
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

  it('links multiple alerts, associates evidence events, records findings, and exports a structured report', async () => {
    const { workspaceId, cookie, userId } = await makeUserAndWorkspace('case_rpt_owner');

    // 1. Insert security events
    const ev1Res = await pool.query(
      `INSERT INTO security_events (
        tenant_id, source_type, source_host, event_type, severity, occurred_at, username, source_ip, message, evidence, ingestion_source
      ) VALUES ($1, 'linux_auth', 'bastion-01', 'ssh_login_failure', 'medium', '2026-10-26T08:00:00Z', 'attacker', '198.51.100.25', 'Auth failure', '{"line_number": 12}'::jsonb, 'test')
      RETURNING id;`,
      [workspaceId]
    );
    const ev1Id = ev1Res.rows[0].id;

    const ev2Res = await pool.query(
      `INSERT INTO security_events (
        tenant_id, source_type, source_host, event_type, severity, occurred_at, username, source_ip, message, evidence, ingestion_source
      ) VALUES ($1, 'linux_auth', 'bastion-01', 'ssh_login_success', 'high', '2026-10-26T08:05:00Z', 'attacker', '198.51.100.25', 'Auth success', '{"line_number": 18}'::jsonb, 'test')
      RETURNING id;`,
      [workspaceId]
    );
    const ev2Id = ev2Res.rows[0].id;

    // 2. Insert alerts
    const fp1 = crypto.createHash('sha256').update(`rpt_fp1_${Date.now()}`).digest('hex');
    const a1Res = await pool.query(
      `INSERT INTO alerts (
        workspace_id, rule_id, rule_version, rule_name, severity, status, title, summary, reason, fingerprint,
        first_event_at, last_event_at, event_count, metadata
      ) VALUES (
        $1, 'AUTH_REPEATED_FAILURES', '1.0.0', 'Repeated Auth Failures', 'medium', 'open',
        'Brute force pattern', 'Multiple failures recorded', 'Exceeded 5 failures in 300s window',
        $2, '2026-10-26T08:00:00Z', '2026-10-26T08:04:00Z', 5, '{}'::jsonb
      ) RETURNING id;`,
      [workspaceId, fp1]
    );
    const a1Id = a1Res.rows[0].id;

    const fp2 = crypto.createHash('sha256').update(`rpt_fp2_${Date.now()}`).digest('hex');
    const a2Res = await pool.query(
      `INSERT INTO alerts (
        workspace_id, rule_id, rule_version, rule_name, severity, status, title, summary, reason, fingerprint,
        first_event_at, last_event_at, event_count, metadata
      ) VALUES (
        $1, 'AUTH_SUCCESS_AFTER_FAILURES', '1.0.0', 'Success After Failures', 'critical', 'open',
        'Account Compromise After Probing', 'Success following brute force', 'Detected success from 198.51.100.25 following failures',
        $2, '2026-10-26T08:00:00Z', '2026-10-26T08:05:00Z', 6, '{}'::jsonb
      ) RETURNING id;`,
      [workspaceId, fp2]
    );
    const a2Id = a2Res.rows[0].id;

    // Link alerts to events
    await pool.query(
      `INSERT INTO alert_events (alert_id, event_id, role) VALUES 
        ($1, $2, 'trigger'),
        ($3, $2, 'supporting'),
        ($3, $4, 'trigger');`,
      [a1Id, ev1Id, a2Id, ev2Id]
    );

    // 3. Create case from first alert
    const createRes = await request(app)
      .post(`/api/v1/workspaces/${workspaceId}/cases`)
      .set('Cookie', cookie)
      .send({
        alertId: a1Id,
        title: 'Bastion SSH Incursion Investigation',
        description: 'Comprehensive investigation into unauthorized access to bastion-01.',
      });
    expect(createRes.status).toBe(201);
    const caseId = createRes.body.case.id;

    // 4. Link second alert to the case
    const linkRes = await request(app)
      .post(`/api/v1/workspaces/${workspaceId}/cases/${caseId}/alerts`)
      .set('Cookie', cookie)
      .send({ alertId: a2Id });
    expect(linkRes.status).toBe(200);

    // 5. Add analyst notes
    const noteRes = await request(app)
      .post(`/api/v1/workspaces/${workspaceId}/cases/${caseId}/notes`)
      .set('Cookie', cookie)
      .send({ content: 'Host bastion-01 isolated. Firewall rule added blocking 198.51.100.25.' });
    expect(noteRes.status).toBe(201);

    // 6. Transition status to in_progress
    const statusRes = await request(app)
      .patch(`/api/v1/workspaces/${workspaceId}/cases/${caseId}/status`)
      .set('Cookie', cookie)
      .send({ status: 'in_progress' });
    expect(statusRes.status).toBe(200);

    // 7. Export structured investigation report
    const exportRes = await request(app)
      .get(`/api/v1/workspaces/${workspaceId}/cases/${caseId}/export?format=json`)
      .set('Cookie', cookie);

    expect(exportRes.status).toBe(200);
    expect(exportRes.headers['content-type']).toContain('application/json');
    expect(exportRes.headers['content-disposition']).toContain('attachment; filename=');

    const report = exportRes.body;

    // Validate Report Metadata
    expect(report.reportMetadata).toBeDefined();
    expect(report.reportMetadata.reportType).toBe('SECURITY_INVESTIGATION_CASE_REPORT');
    expect(report.reportMetadata.workspace.id).toBe(workspaceId);
    expect(report.reportMetadata.generatedBy.id).toBe(userId);

    // Validate Case Information
    expect(report.caseInformation).toBeDefined();
    expect(report.caseInformation.caseId).toBe(caseId);
    expect(report.caseInformation.title).toBe('Bastion SSH Incursion Investigation');
    expect(report.caseInformation.status).toBe('in_progress');

    // Validate Scope and Timeframe
    expect(report.investigationScopeAndTimeframe).toBeDefined();
    expect(report.investigationScopeAndTimeframe.evidenceTimeframe.earliestObservedEvent).toBe('2026-10-26T08:00:00.000Z');
    expect(report.investigationScopeAndTimeframe.evidenceTimeframe.latestObservedEvent).toBe('2026-10-26T08:05:00.000Z');
    expect(report.investigationScopeAndTimeframe.caseLifecycleTimeframe.investigationOpenedAt).toBeDefined();

    // Validate Detections
    expect(report.detections.length).toBe(2);
    const ruleIds = report.detections.map((d: any) => d.ruleId);
    expect(ruleIds).toContain('AUTH_REPEATED_FAILURES');
    expect(ruleIds).toContain('AUTH_SUCCESS_AFTER_FAILURES');

    // Validate Evidence References
    expect(report.evidenceReferences.length).toBe(3);
    const eventIds = report.evidenceReferences.map((e: any) => e.eventId);
    expect(eventIds).toContain(ev1Id);
    expect(eventIds).toContain(ev2Id);
    expect(report.evidenceReferences[0].sourceIp).toBe('198.51.100.25');

    // Validate Findings & Notes
    expect(report.findingsAndNotes.length).toBe(1);
    expect(report.findingsAndNotes[0].content).toContain('bastion-01 isolated');
    expect(report.findingsAndNotes[0].author.id).toBe(userId);

    // Validate Timeline
    expect(report.timeline.length).toBeGreaterThanOrEqual(4);
    const auditActions = report.timeline.map((t: any) => t.action);
    expect(auditActions).toContain('case_created');
    expect(auditActions).toContain('alert_linked');
    expect(auditActions).toContain('note_added');
    expect(auditActions).toContain('status_changed');

    // Validate Caveats & Limitations
    expect(report.caveatsAndLimitations.length).toBeGreaterThanOrEqual(3);

    // 8. Test Export on Empty Case (case with no alerts or notes)
    const emptyCaseRes = await request(app)
      .post(`/api/v1/workspaces/${workspaceId}/cases`)
      .set('Cookie', cookie)
      .send({
        title: 'Fresh Minimal Investigation',
        description: 'No initial alerts linked',
      });
    const emptyCaseId = emptyCaseRes.body.case.id;

    const emptyExportRes = await request(app)
      .get(`/api/v1/workspaces/${workspaceId}/cases/${emptyCaseId}/export?format=json`)
      .set('Cookie', cookie);

    expect(emptyExportRes.status).toBe(200);
    expect(emptyExportRes.body.detections).toEqual([]);
    expect(emptyExportRes.body.evidenceReferences).toEqual([]);
    expect(emptyExportRes.body.findingsAndNotes).toEqual([]);
    expect(emptyExportRes.body.investigationScopeAndTimeframe.evidenceTimeframe.earliestObservedEvent).toBeNull();
  });

  it('rejects cross-workspace report export attempts and unauthenticated requests', async () => {
    const wsA = await makeUserAndWorkspace('case_exp_a');
    const wsB = await makeUserAndWorkspace('case_exp_b');

    // Create case in Workspace A
    const createRes = await request(app)
      .post(`/api/v1/workspaces/${wsA.workspaceId}/cases`)
      .set('Cookie', wsA.cookie)
      .send({
        title: 'Sensitive Workspace A Findings',
      });
    const caseId = createRes.body.case.id;

    // User B attempting to export Workspace A case gets 404
    const idorRes = await request(app)
      .get(`/api/v1/workspaces/${wsB.workspaceId}/cases/${caseId}/export`)
      .set('Cookie', wsB.cookie);
    expect(idorRes.status).toBe(404);

    // Unauthenticated export gets 401
    const unauthRes = await request(app)
      .get(`/api/v1/workspaces/${wsA.workspaceId}/cases/${caseId}/export`);
    expect(unauthRes.status).toBe(401);
  });
});

