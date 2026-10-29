import { describe, it, expect } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/pool.js';
import { config } from '../src/config/env.js';
import { inMemorySentEmails } from '../src/services/email.js';

describe('Live Ingestion, Integration Health & Alert Notifications', () => {
  const app = createApp();

  const makeUser = async (label: string) => {
    const email = `test_${label}_${crypto.randomBytes(4).toString('hex')}@example.com`;
    const password = 'Password123!';
    const regRes = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email,
        password,
        fullName: `Test User ${label}`,
        workspaceName: `Workspace ${label}`,
      });

    const cookieHeader = regRes.headers['set-cookie'] as unknown as string[];
    const sessionCookie = cookieHeader
      .find((c: string) => c.startsWith(`${config.auth.sessionCookieName}=`))!
      .split(';')[0];

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

  const enrollAgent = async (ownerCookie: string, workspaceId: string, name: string) => {
    // 1. Create integration
    const createRes = await request(app)
      .post(`/api/v1/workspaces/${workspaceId}/integrations`)
      .set('Cookie', ownerCookie)
      .send({ name, integrationType: 'linux_auth' });
    expect(createRes.status).toBe(201);
    const integrationId = createRes.body.integration.id;

    // 2. Generate token
    const tokenRes = await request(app)
      .post(`/api/v1/workspaces/${workspaceId}/integrations/${integrationId}/enrollment`)
      .set('Cookie', ownerCookie);
    expect(tokenRes.status).toBe(201);
    const rawToken = tokenRes.body.enrollmentToken;

    // 3. Consume token
    const enrollRes = await request(app)
      .post('/api/v1/integrations/enroll')
      .send({
        enrollmentToken: rawToken,
        agentMetadata: { hostname: `${name.toLowerCase().replace(/\s+/g, '-')}.infra.local`, os: 'Ubuntu 24.04' },
      });
    expect(enrollRes.status).toBe(200);

    return {
      integrationId,
      agentId: enrollRes.body.agentId as string,
      agentKey: enrollRes.body.agentKey as string,
    };
  };

  it('handles agent batch event ingestion with idempotent deduplication and itemized feedback', async () => {
    const owner = await makeUser('IngestDedup');
    const agent = await enrollAgent(owner.sessionCookie, owner.workspaceId, 'Web Server 01');

    const eventId1 = crypto.randomUUID();
    const eventId2 = crypto.randomUUID();
    const eventId3 = crypto.randomUUID();

    const initialBatch = [
      {
        id: eventId1,
        source_type: 'linux_auth',
        source_host: 'web-01.infra.local',
        event_type: 'ssh_login_success',
        severity: 'info',
        occurred_at: new Date(Date.now() - 30000).toISOString(),
        username: 'deploy',
        source_ip: '192.168.1.100',
        process_name: 'sshd',
        message: 'Accepted publickey for deploy from 192.168.1.100 port 54222 ssh2',
        evidence: { raw_line: 'Accepted publickey for deploy' },
      },
      {
        id: eventId2,
        source_type: 'linux_auth',
        source_host: 'web-01.infra.local',
        event_type: 'sudo_execution',
        severity: 'low',
        occurred_at: new Date(Date.now() - 20000).toISOString(),
        username: 'deploy',
        process_name: 'sudo',
        message: 'deploy : TTY=pts/0 ; PWD=/home/deploy ; USER=root ; COMMAND=/bin/systemctl restart nginx',
        evidence: { raw_line: 'deploy : COMMAND=/bin/systemctl restart nginx' },
      },
      {
        id: eventId3,
        source_type: 'linux_auth',
        source_host: 'web-01.infra.local',
        event_type: 'ssh_login_failure',
        severity: 'medium',
        occurred_at: new Date(Date.now() - 10000).toISOString(),
        username: 'admin',
        source_ip: '10.0.0.50',
        process_name: 'sshd',
        message: 'Failed password for invalid user admin from 10.0.0.50 port 41234 ssh2',
        evidence: { raw_line: 'Failed password for invalid user admin' },
      },
    ];

    // 1. Initial delivery of 3 events: all accepted
    const firstDeliveryRes = await request(app)
      .post('/api/v1/integrations/agent/events')
      .set('Authorization', `Bearer ${agent.agentKey}`)
      .set('X-Agent-Id', agent.agentId)
      .send({ batchId: 'batch-001', events: initialBatch });

    expect(firstDeliveryRes.status).toBe(200);
    expect(firstDeliveryRes.body.status).toBe('ok');
    expect(firstDeliveryRes.body.batchStatus).toBe('accepted');
    expect(firstDeliveryRes.body.acceptedCount).toBe(3);
    expect(firstDeliveryRes.body.duplicateCount).toBe(0);
    expect(firstDeliveryRes.body.rejectedCount).toBe(0);
    expect(firstDeliveryRes.body.items).toHaveLength(3);
    expect(firstDeliveryRes.body.items.every((it: { status: string }) => it.status === 'accepted')).toBe(true);

    // Verify database row attribution: integration_id should be populated
    const dbRowsRes = await pool.query(
      `SELECT id, tenant_id, integration_id, ingestion_source FROM security_events WHERE id = ANY($1)`,
      [[eventId1, eventId2, eventId3]]
    );
    expect(dbRowsRes.rows).toHaveLength(3);
    for (const row of dbRowsRes.rows) {
      expect(row.tenant_id).toBe(owner.workspaceId);
      expect(row.integration_id).toBe(agent.integrationId);
      expect(row.ingestion_source).toBe('linux_agent');
    }

    // 2. Re-delivery of the exact same batch: all duplicate, safely acknowledged
    const redeliveryRes = await request(app)
      .post('/api/v1/integrations/agent/events')
      .set('Authorization', `Bearer ${agent.agentKey}`)
      .set('X-Agent-Id', agent.agentId)
      .send({ batchId: 'batch-001-retry', events: initialBatch });

    expect(redeliveryRes.status).toBe(200);
    expect(redeliveryRes.body.status).toBe('ok');
    expect(redeliveryRes.body.batchStatus).toBe('partially_accepted');
    expect(redeliveryRes.body.newlyAcceptedCount).toBe(0);
    expect(redeliveryRes.body.acceptedCount).toBe(3);
    expect(redeliveryRes.body.duplicateCount).toBe(3);
    expect(redeliveryRes.body.rejectedCount).toBe(0);
    expect(redeliveryRes.body.items.every((it: { status: string }) => it.status === 'duplicate')).toBe(true);

    // 3. Partial batch: 1 new event, 1 duplicate (eventId1), 1 schema-invalid event
    const eventId4 = crypto.randomUUID();
    const partialBatch = [
      {
        id: eventId4,
        source_type: 'linux_auth',
        source_host: 'web-01.infra.local',
        event_type: 'session_opened',
        severity: 'info',
        occurred_at: new Date().toISOString(),
        username: 'deploy',
        process_name: 'systemd-logind',
        message: 'New session 42 of user deploy.',
        evidence: {},
      },
      initialBatch[0], // Duplicate eventId1
      {
        id: 'not-a-valid-uuid', // Malformed UUID
        source_type: 'unknown_source_type_invalid', // Invalid enum
        message: 'Broken event',
      },
    ];

    const partialRes = await request(app)
      .post('/api/v1/integrations/agent/events')
      .set('Authorization', `Bearer ${agent.agentKey}`)
      .set('X-Agent-Id', agent.agentId)
      .send({ batchId: 'batch-partial', events: partialBatch });

    expect(partialRes.status).toBe(200);
    expect(partialRes.body.batchStatus).toBe('partially_accepted');
    expect(partialRes.body.total).toBe(3);
    expect(partialRes.body.acceptedCount).toBe(2);
    expect(partialRes.body.newlyAcceptedCount).toBe(1);
    expect(partialRes.body.duplicateCount).toBe(1);
    expect(partialRes.body.rejectedCount).toBe(1);

    const acceptedItem = partialRes.body.items.find((it: { id: string }) => it.id === eventId4);
    expect(acceptedItem.status).toBe('accepted');

    const duplicateItem = partialRes.body.items.find((it: { id: string }) => it.id === eventId1);
    expect(duplicateItem.status).toBe('duplicate');

    const rejectedItem = partialRes.body.items.find((it: { id: string }) => it.id === 'not-a-valid-uuid');
    expect(rejectedItem.status).toBe('rejected');

    // 4. Batch where ALL events fail schema: returns HTTP 422
    const allInvalidBatch = [
      { id: 'bad-1', source_type: 'invalid', message: 'Fail 1' },
      { id: 'bad-2', source_type: 'invalid', message: 'Fail 2' },
    ];
    const allInvalidRes = await request(app)
      .post('/api/v1/integrations/agent/events')
      .set('Authorization', `Bearer ${agent.agentKey}`)
      .set('X-Agent-Id', agent.agentId)
      .send({ batchId: 'batch-all-invalid', events: allInvalidBatch });

    expect(allInvalidRes.status).toBe(422);
    expect(allInvalidRes.body.batchStatus).toBe('rejected');
    expect(allInvalidRes.body.rejectedCount).toBe(2);
  });

  it('records heartbeat diagnostics and reflects fleet health and throughput in health summary endpoint', async () => {
    const owner = await makeUser('FleetHealth');
    const agent = await enrollAgent(owner.sessionCookie, owner.workspaceId, 'Database Primary');

    // 1. Send heartbeat carrying runtime diagnostics
    const heartbeatRes = await request(app)
      .post('/api/v1/integrations/agent/heartbeat')
      .set('Authorization', `Bearer ${agent.agentKey}`)
      .set('X-Agent-Id', agent.agentId)
      .send({
        diagnostics: {
          pending_buffer_events: 12,
          buffer_storage_bytes: 40960,
          line_number: 1420,
          current_offset: 89400,
          status: 'RUNNING',
          agent_version: '0.1.0',
        },
      });

    expect(heartbeatRes.status).toBe(200);
    expect(heartbeatRes.body.message).toBe('Heartbeat acknowledged.');

    // 2. Query workspace fleet health endpoint
    const healthRes = await request(app)
      .get(`/api/v1/workspaces/${owner.workspaceId}/integrations/health`)
      .set('Cookie', owner.sessionCookie);

    expect(healthRes.status).toBe(200);
    expect(healthRes.body.workspaceId).toBe(owner.workspaceId);
    expect(healthRes.body.summary).toBeDefined();
    expect(healthRes.body.summary.totalIntegrations).toBe(1);
    expect(healthRes.body.summary.connected).toBe(1);

    const integrationObj = healthRes.body.integrations.find(
      (it: { id: string }) => it.id === agent.integrationId
    );
    expect(integrationObj).toBeDefined();
    expect(integrationObj.healthStatus).toBe('connected');
    expect(integrationObj.metadata.agentDiagnostics).toBeDefined();
    expect(integrationObj.metadata.agentDiagnostics.pending_buffer_events).toBe(12);
    expect(integrationObj.metadata.agentDiagnostics.buffer_storage_bytes).toBe(40960);
    expect(integrationObj.metadata.agentDiagnostics.line_number).toBe(1420);

    // 3. Unauthorized access check: non-member gets 403
    const outsider = await makeUser('FleetOutsider');
    const unauthorizedRes = await request(app)
      .get(`/api/v1/workspaces/${owner.workspaceId}/integrations/health`)
      .set('Cookie', outsider.sessionCookie);

    expect(unauthorizedRes.status).toBe(403);
  });

  it('manages workspace alert notification preferences with strict RBAC and input validation', async () => {
    const owner = await makeUser('NotifRBAC');
    const viewer = await makeUser('NotifViewer');
    await addMemberWithRole(owner.sessionCookie, owner.workspaceId, viewer.email, 'viewer');

    // 1. Viewer can view settings (receives defaults)
    const getRes = await request(app)
      .get(`/api/v1/workspaces/${owner.workspaceId}/notifications/settings`)
      .set('Cookie', viewer.sessionCookie);

    expect(getRes.status).toBe(200);
    expect(getRes.body.settings.enabled).toBe(true);
    expect(getRes.body.settings.minSeverity).toBe('medium');
    expect(getRes.body.settings.notifyEmails).toEqual([]);

    // 2. Viewer CANNOT update notification settings (requires admin/owner)
    const viewerForbidden = await request(app)
      .patch(`/api/v1/workspaces/${owner.workspaceId}/notifications/settings`)
      .set('Cookie', viewer.sessionCookie)
      .send({ enabled: false });

    expect(viewerForbidden.status).toBe(403);

    // 3. Validation: rejects invalid email address
    const badEmailRes = await request(app)
      .patch(`/api/v1/workspaces/${owner.workspaceId}/notifications/settings`)
      .set('Cookie', owner.sessionCookie)
      .send({ notifyEmails: ['not-an-email-address'] });

    expect(badEmailRes.status).toBe(400);
    expect(badEmailRes.body.message).toContain('Invalid email address format');

    // 4. Validation: rejects invalid minSeverity
    const badSevRes = await request(app)
      .patch(`/api/v1/workspaces/${owner.workspaceId}/notifications/settings`)
      .set('Cookie', owner.sessionCookie)
      .send({ minSeverity: 'catastrophic' });

    expect(badSevRes.status).toBe(400);
    expect(badSevRes.body.message).toContain('Invalid minSeverity');

    // 5. Owner updates settings with valid preferences
    const updateRes = await request(app)
      .patch(`/api/v1/workspaces/${owner.workspaceId}/notifications/settings`)
      .set('Cookie', owner.sessionCookie)
      .send({
        enabled: true,
        minSeverity: 'high',
        notifyEmails: ['soc-lead@example.com', 'incident-response@example.com'],
        includeEvidenceSummary: true,
      });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.settings.minSeverity).toBe('high');
    expect(updateRes.body.settings.notifyEmails).toEqual([
      'soc-lead@example.com',
      'incident-response@example.com',
    ]);
  });

  it('triggers email alerts upon security threat detection, suppresses duplicates, and logs notification history', async () => {
    const owner = await makeUser('ThreatAlertNotif');
    const agent = await enrollAgent(owner.sessionCookie, owner.workspaceId, 'Edge Firewall 01');

    // 1. Configure workspace notification settings
    const targetEmail = `soc_${crypto.randomBytes(4).toString('hex')}@example.com`;
    await request(app)
      .patch(`/api/v1/workspaces/${owner.workspaceId}/notifications/settings`)
      .set('Cookie', owner.sessionCookie)
      .send({
        enabled: true,
        minSeverity: 'medium',
        notifyEmails: [targetEmail],
        includeEvidenceSummary: true,
      });

    // 2. Ingest 6 rapid failed SSH logins from single attacker IP to trigger SSH Brute Force Detection rule
    const attackerIp = '203.0.113.88';
    const baseTime = Date.now() - 60000;
    const bruteForceEvents = Array.from({ length: 6 }).map((_, idx) => ({
      id: crypto.randomUUID(),
      source_type: 'linux_auth',
      source_host: 'edge-01.infra.local',
      event_type: 'ssh_login_failure',
      severity: 'medium',
      occurred_at: new Date(baseTime + idx * 5000).toISOString(),
      username: 'admin',
      source_ip: attackerIp,
      process_name: 'sshd',
      message: `Failed password for admin from ${attackerIp} port ${45000 + idx} ssh2`,
      evidence: { raw_line: `Failed password for admin from ${attackerIp}` },
    }));

    inMemorySentEmails.length = 0; // Clear previous mock emails

    const ingestRes = await request(app)
      .post('/api/v1/integrations/agent/events')
      .set('Authorization', `Bearer ${agent.agentKey}`)
      .set('X-Agent-Id', agent.agentId)
      .send({ batchId: 'batch-brute-force', events: bruteForceEvents });

    expect(ingestRes.status).toBe(200);
    expect(ingestRes.body.acceptedCount).toBe(6);
    expect(ingestRes.body.alertsGenerated).toBeGreaterThanOrEqual(1);

    // 3. Verify that an alert notification email was dispatched to targetEmail
    const dispatchedEmail = inMemorySentEmails.find(
      (em) => em.to === targetEmail && em.type === 'alert_notification'
    );
    expect(dispatchedEmail).toBeDefined();
    expect(dispatchedEmail!.subject).toContain('[SECURITY ALERT]');
    expect(dispatchedEmail!.alertPayload?.eventCount).toBeGreaterThanOrEqual(5);

    // 4. Verify notification delivery audit log in database
    const historyRes = await request(app)
      .get(`/api/v1/workspaces/${owner.workspaceId}/notifications/history`)
      .set('Cookie', owner.sessionCookie);

    expect(historyRes.status).toBe(200);
    expect(historyRes.body.total).toBeGreaterThanOrEqual(1);
    const historyItem = historyRes.body.notifications.find(
      (n: { recipientEmail: string }) => n.recipientEmail === targetEmail
    );
    expect(historyItem).toBeDefined();
    expect(historyItem.status).toBe('sent');
    expect(historyItem.alertTitle).toBeDefined();

    // 5. Test notification endpoint
    const testNotifRes = await request(app)
      .post(`/api/v1/workspaces/${owner.workspaceId}/notifications/test`)
      .set('Cookie', owner.sessionCookie)
      .send({ recipientEmail: targetEmail });

    expect(testNotifRes.status).toBe(200);
    expect(testNotifRes.body.status).toBe('ok');
  });
});
