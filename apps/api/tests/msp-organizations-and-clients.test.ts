import { describe, it, expect } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/pool.js';
import { config } from '../src/config/env.js';

describe('MSP Multi-Client Platform & Strict Tenant Isolation', () => {
  const app = createApp();

  const makeUser = async (label: string) => {
    const email = `msp_${label}_${crypto.randomBytes(4).toString('hex')}@example.com`;
    const password = 'Password123!';
    const regRes = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email,
        password,
        fullName: `MSP User ${label}`,
        workspaceName: `Standalone Workspace ${label}`,
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

  it('1. should create an MSP organization and assign creator as owner', async () => {
    const owner = await makeUser('org_owner');

    // Create Organization
    const createRes = await request(app)
      .post('/api/v1/organizations')
      .set('Cookie', owner.sessionCookie)
      .send({
        name: 'Apex Managed Security Services',
        metadata: { tier: 'enterprise', primaryContact: owner.email },
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.status).toBe('created');
    expect(createRes.body.organization.name).toBe('Apex Managed Security Services');
    expect(createRes.body.organization.role).toBe('owner');
    expect(createRes.body.organization.id).toBeDefined();

    const orgId = createRes.body.organization.id;

    // Retrieve organization details
    const getRes = await request(app)
      .get(`/api/v1/organizations/${orgId}`)
      .set('Cookie', owner.sessionCookie);

    expect(getRes.status).toBe(200);
    expect(getRes.body.organization.id).toBe(orgId);
    expect(getRes.body.organization.myRole).toBe('owner');
    expect(getRes.body.organization.clientCount).toBe(0);

    // List user organizations
    const listRes = await request(app)
      .get('/api/v1/organizations')
      .set('Cookie', owner.sessionCookie);

    expect(listRes.status).toBe(200);
    expect(listRes.body.organizations.length).toBeGreaterThanOrEqual(1);
    const found = listRes.body.organizations.find((o: any) => o.id === orgId);
    expect(found).toBeDefined();
    expect(found.role).toBe('owner');
  });

  it('2. should enforce role-based access control within the MSP organization', async () => {
    const owner = await makeUser('rbac_owner');
    const admin = await makeUser('rbac_admin');
    const analyst = await makeUser('rbac_analyst');
    const viewer = await makeUser('rbac_viewer');
    const outsider = await makeUser('rbac_outsider');

    // Owner creates organization
    const orgRes = await request(app)
      .post('/api/v1/organizations')
      .set('Cookie', owner.sessionCookie)
      .send({ name: 'Sentinel SOC MSP' });
    const orgId = orgRes.body.organization.id;

    // Add Admin, Analyst, and Viewer members
    const addAdminRes = await request(app)
      .post(`/api/v1/organizations/${orgId}/members`)
      .set('Cookie', owner.sessionCookie)
      .send({ email: admin.email, role: 'admin' });
    expect(addAdminRes.status).toBe(201);

    const addAnalystRes = await request(app)
      .post(`/api/v1/organizations/${orgId}/members`)
      .set('Cookie', owner.sessionCookie)
      .send({ email: analyst.email, role: 'analyst' });
    expect(addAnalystRes.status).toBe(201);

    const addViewerRes = await request(app)
      .post(`/api/v1/organizations/${orgId}/members`)
      .set('Cookie', owner.sessionCookie)
      .send({ email: viewer.email, role: 'viewer' });
    expect(addViewerRes.status).toBe(201);

    // Outsider cannot access organization
    const outsiderRes = await request(app)
      .get(`/api/v1/organizations/${orgId}`)
      .set('Cookie', outsider.sessionCookie);
    expect(outsiderRes.status).toBe(403);
    expect(outsiderRes.body.message).toContain('not a member of this organization');

    // Admin can create a client workspace
    const adminCreateClient = await request(app)
      .post(`/api/v1/organizations/${orgId}/clients`)
      .set('Cookie', admin.sessionCookie)
      .send({ name: 'Client 1 - Created by Admin' });
    expect(adminCreateClient.status).toBe(201);

    // Analyst cannot create a client workspace (requires admin)
    const analystCreateClient = await request(app)
      .post(`/api/v1/organizations/${orgId}/clients`)
      .set('Cookie', analyst.sessionCookie)
      .send({ name: 'Client 2 - Should Fail' });
    expect(analystCreateClient.status).toBe(403);

    // Viewer cannot create a client workspace (requires admin)
    const viewerCreateClient = await request(app)
      .post(`/api/v1/organizations/${orgId}/clients`)
      .set('Cookie', viewer.sessionCookie)
      .send({ name: 'Client 3 - Should Fail' });
    expect(viewerCreateClient.status).toBe(403);

    // Viewer CAN list clients
    const viewerListClients = await request(app)
      .get(`/api/v1/organizations/${orgId}/clients`)
      .set('Cookie', viewer.sessionCookie);
    expect(viewerListClients.status).toBe(200);
    expect(viewerListClients.body.clients.length).toBe(1);

    // Cannot demote sole owner
    const demoteOwnerRes = await request(app)
      .patch(`/api/v1/organizations/${orgId}/members/${owner.userId}`)
      .set('Cookie', admin.sessionCookie)
      .send({ role: 'admin' });
    expect(demoteOwnerRes.status).toBe(403); // Admin cannot demote owner
  });

  it('3. should support creating multiple client workspaces and maintaining strict tenant isolation', async () => {
    const mspOwner = await makeUser('msp_lead');
    const clientAUser = await makeUser('client_a_user');
    const clientBUser = await makeUser('client_b_user');

    // 1. Create MSP organization
    const orgRes = await request(app)
      .post('/api/v1/organizations')
      .set('Cookie', mspOwner.sessionCookie)
      .send({ name: 'CyberShield MSP Solutions' });
    const orgId = orgRes.body.organization.id;

    // 2. Create Client A (Manufacturing) and Client B (Retail)
    const clientARes = await request(app)
      .post(`/api/v1/organizations/${orgId}/clients`)
      .set('Cookie', mspOwner.sessionCookie)
      .send({
        name: 'Client A - Precision Manufacturing',
        metadata: { industry: 'Manufacturing', contact: clientAUser.email },
      });
    expect(clientARes.status).toBe(201);
    const clientAId = clientARes.body.client.id;

    const clientBRes = await request(app)
      .post(`/api/v1/organizations/${orgId}/clients`)
      .set('Cookie', mspOwner.sessionCookie)
      .send({
        name: 'Client B - Apex Retail Group',
        metadata: { industry: 'Retail', contact: clientBUser.email },
      });
    expect(clientBRes.status).toBe(201);
    const clientBId = clientBRes.body.client.id;

    // 3. Add clientAUser strictly to Client A workspace, and clientBUser strictly to Client B workspace
    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, 'viewer')`,
      [clientAId, clientAUser.userId]
    );

    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, 'viewer')`,
      [clientBId, clientBUser.userId]
    );

    // 4. Populate synthetic security data for Client A
    const eventAId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO security_events (
        id, tenant_id, source_type, source_host, event_type, severity, occurred_at, observed_at, username, source_ip, message, evidence, ingestion_source
      ) VALUES ($1, $2, 'linux_auth', 'client-a-host', 'ssh_login_failure', 'medium', NOW(), NOW(), 'admin', '10.10.10.50', 'Failed password', '{"outcome":"failure"}'::jsonb, 'live_agent')`,
      [eventAId, clientAId]
    );

    const alertARes = await pool.query(
      `INSERT INTO alerts (
        workspace_id, rule_id, rule_version, rule_name, title, summary, reason, severity, status, fingerprint, first_event_at, last_event_at, event_count
      ) VALUES ($1, 'rule_repeat', '1.0.0', 'repeated_failures', 'Client A SSH Brute Force', 'Alert on Client A', 'Multiple failed logins', 'high', 'open', 'fp_a_${crypto.randomBytes(4).toString('hex')}', NOW(), NOW(), 1)
      RETURNING id`,
      [clientAId]
    );
    const alertAId = alertARes.rows[0].id;

    // Link supporting event to alert
    await pool.query(
      `INSERT INTO alert_events (alert_id, event_id, role) VALUES ($1, $2, 'trigger')`,
      [alertAId, eventAId]
    );

    const caseARes = await pool.query(
      `INSERT INTO cases (
        workspace_id, title, description, priority, status, created_by
      ) VALUES ($1, 'Investigation Case A', 'Client A Incident', 'high', 'open', $2)
      RETURNING id`,
      [clientAId, mspOwner.userId]
    );
    const caseAId = caseARes.rows[0].id;

    // 5. Populate synthetic security data for Client B
    const eventBId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO security_events (
        id, tenant_id, source_type, source_host, event_type, severity, occurred_at, observed_at, username, source_ip, message, evidence, ingestion_source
      ) VALUES ($1, $2, 'linux_auth', 'client-b-host', 'ssh_login_failure', 'medium', NOW(), NOW(), 'root', '172.16.0.99', 'Failed root login', '{"outcome":"failure"}'::jsonb, 'live_agent')`,
      [eventBId, clientBId]
    );

    const alertBRes = await pool.query(
      `INSERT INTO alerts (
        workspace_id, rule_id, rule_version, rule_name, title, summary, reason, severity, status, fingerprint, first_event_at, last_event_at, event_count
      ) VALUES ($1, 'rule_repeat', '1.0.0', 'repeated_failures', 'Client B SSH Brute Force', 'Alert on Client B', 'Multiple failed logins', 'critical', 'open', 'fp_b_${crypto.randomBytes(4).toString('hex')}', NOW(), NOW(), 1)
      RETURNING id`,
      [clientBId]
    );
    const alertBId = alertBRes.rows[0].id;

    // Link supporting event to alert
    await pool.query(
      `INSERT INTO alert_events (alert_id, event_id, role) VALUES ($1, $2, 'trigger')`,
      [alertBId, eventBId]
    );

    const caseBRes = await pool.query(
      `INSERT INTO cases (
        workspace_id, title, description, priority, status, created_by
      ) VALUES ($1, 'Investigation Case B', 'Client B Incident', 'critical', 'open', $2)
      RETURNING id`,
      [clientBId, mspOwner.userId]
    );
    const caseBId = caseBRes.rows[0].id;

    // 6. VERIFY ISOLATION: Client A user CAN view Client A resources
    const clientAAlerts = await request(app)
      .get(`/api/v1/workspaces/${clientAId}/alerts`)
      .set('Cookie', clientAUser.sessionCookie);
    expect(clientAAlerts.status).toBe(200);
    expect(clientAAlerts.body.alerts.length).toBe(1);
    expect(clientAAlerts.body.alerts[0].id).toBe(alertAId);

    // 7. VERIFY ISOLATION: Client A user CANNOT view Client B's alerts (403 Forbidden)
    const clientATryingClientBAlerts = await request(app)
      .get(`/api/v1/workspaces/${clientBId}/alerts`)
      .set('Cookie', clientAUser.sessionCookie);
    expect(clientATryingClientBAlerts.status).toBe(403);
    expect(clientATryingClientBAlerts.body.message).toContain('not a member of this workspace');

    // 8. VERIFY ISOLATION: Client A user CANNOT view Client B's cases (403 Forbidden)
    const clientATryingClientBCases = await request(app)
      .get(`/api/v1/workspaces/${clientBId}/cases`)
      .set('Cookie', clientAUser.sessionCookie);
    expect(clientATryingClientBCases.status).toBe(403);

    // 9. VERIFY ISOLATION: Client A user CANNOT view Client B's case detail via IDOR
    const clientAIDORCase = await request(app)
      .get(`/api/v1/workspaces/${clientBId}/cases/${caseBId}`)
      .set('Cookie', clientAUser.sessionCookie);
    expect(clientAIDORCase.status).toBe(403);

    // 10. VERIFY ISOLATION: Client A user CANNOT export Client B's report
    const clientAIDORExport = await request(app)
      .get(`/api/v1/workspaces/${clientBId}/cases/${caseBId}/export`)
      .set('Cookie', clientAUser.sessionCookie);
    expect(clientAIDORExport.status).toBe(403);

    // 11. VERIFY ISOLATION: Client A user CANNOT access the MSP organization
    const clientATryingOrg = await request(app)
      .get(`/api/v1/organizations/${orgId}`)
      .set('Cookie', clientAUser.sessionCookie);
    expect(clientATryingOrg.status).toBe(403);

    // 12. VERIFY ISOLATION: Client B user CANNOT view Client A's alerts or cases
    const clientBTryingClientA = await request(app)
      .get(`/api/v1/workspaces/${clientAId}/alerts`)
      .set('Cookie', clientBUser.sessionCookie);
    expect(clientBTryingClientA.status).toBe(403);
  });

  it('4. should provide centralized monitoring, filtering, and usage metrics across clients for MSP staff', async () => {
    const mspOwner = await makeUser('msp_dashboard');

    // Create Organization & Clients
    const orgRes = await request(app)
      .post('/api/v1/organizations')
      .set('Cookie', mspOwner.sessionCookie)
      .send({ name: 'Guardian SOC' });
    const orgId = orgRes.body.organization.id;

    const c1 = await request(app)
      .post(`/api/v1/organizations/${orgId}/clients`)
      .set('Cookie', mspOwner.sessionCookie)
      .send({ name: 'Acme Corp' });
    const c1Id = c1.body.client.id;

    const c2 = await request(app)
      .post(`/api/v1/organizations/${orgId}/clients`)
      .set('Cookie', mspOwner.sessionCookie)
      .send({ name: 'Beta Logistics' });
    const c2Id = c2.body.client.id;

    // Seed events and alerts for Acme Corp (High severity)
    const ev1Id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO security_events (id, tenant_id, source_type, source_host, occurred_at, observed_at, source_ip, event_type, severity, message, evidence, ingestion_source)
       VALUES ($1, $2, 'linux_auth', 'acme-server', NOW(), NOW(), '1.1.1.1', 'ssh_login_failure', 'medium', 'msg', '{"outcome":"failure"}'::jsonb, 'live_agent')`,
      [ev1Id, c1Id]
    );
    await pool.query(
      `INSERT INTO alerts (workspace_id, rule_id, rule_version, rule_name, title, summary, reason, severity, status, fingerprint, first_event_at, last_event_at, event_count)
       VALUES ($1, 'r1', '1.0', 'rule_1', 'Acme Alert', 'desc', 'reason', 'high', 'open', 'fp_acme_${crypto.randomBytes(3).toString('hex')}', NOW(), NOW(), 1)`,
      [c1Id]
    );

    // Seed events and alerts for Beta Logistics (Critical severity)
    const ev2Id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO security_events (id, tenant_id, source_type, source_host, occurred_at, observed_at, source_ip, event_type, severity, message, evidence, ingestion_source)
       VALUES ($1, $2, 'linux_auth', 'beta-server', NOW(), NOW(), '2.2.2.2', 'ssh_login_failure', 'medium', 'msg', '{"outcome":"failure"}'::jsonb, 'live_agent')`,
      [ev2Id, c2Id]
    );
    await pool.query(
      `INSERT INTO alerts (workspace_id, rule_id, rule_version, rule_name, title, summary, reason, severity, status, fingerprint, first_event_at, last_event_at, event_count)
       VALUES ($1, 'r2', '1.0', 'rule_2', 'Beta Alert', 'desc', 'reason', 'critical', 'open', 'fp_beta_${crypto.randomBytes(3).toString('hex')}', NOW(), NOW(), 1)`,
      [c2Id]
    );

    // Register servers
    await pool.query(
      `INSERT INTO integrations (id, workspace_id, name, integration_type, status, last_seen_at, created_by)
       VALUES ($1, $2, 'Acme-Bastion', 'linux_auth', 'connected', NOW(), $3)`,
      [crypto.randomUUID(), c1Id, mspOwner.userId]
    );
    await pool.query(
      `INSERT INTO integrations (id, workspace_id, name, integration_type, status, last_seen_at, created_by)
       VALUES ($1, $2, 'Beta-Auth', 'linux_auth', 'degraded', NOW(), $3)`,
      [crypto.randomUUID(), c2Id, mspOwner.userId]
    );

    // Test 1: Consolidated alerts across all clients
    const allAlertsRes = await request(app)
      .get(`/api/v1/organizations/${orgId}/alerts`)
      .set('Cookie', mspOwner.sessionCookie);

    expect(allAlertsRes.status).toBe(200);
    expect(allAlertsRes.body.alerts.length).toBe(2);
    expect(allAlertsRes.body.by_severity.high).toBe(1);
    expect(allAlertsRes.body.by_severity.critical).toBe(1);

    // Test 2: Filter alerts by client_id
    const acmeAlertsRes = await request(app)
      .get(`/api/v1/organizations/${orgId}/alerts?client_id=${c1Id}`)
      .set('Cookie', mspOwner.sessionCookie);

    expect(acmeAlertsRes.status).toBe(200);
    expect(acmeAlertsRes.body.alerts.length).toBe(1);
    expect(acmeAlertsRes.body.alerts[0].title).toBe('Acme Alert');
    expect(acmeAlertsRes.body.alerts[0].client_name).toBe('Acme Corp');

    // Test 3: Consolidated fleet health
    const fleetRes = await request(app)
      .get(`/api/v1/organizations/${orgId}/fleet`)
      .set('Cookie', mspOwner.sessionCookie);

    expect(fleetRes.status).toBe(200);
    expect(fleetRes.body.total_servers).toBe(2);
    expect(fleetRes.body.servers.some((s: any) => s.clientName === 'Acme Corp')).toBe(true);
    expect(fleetRes.body.servers.some((s: any) => s.clientName === 'Beta Logistics')).toBe(true);

    // Test 4: Per-client usage metrics
    const usageRes = await request(app)
      .get(`/api/v1/organizations/${orgId}/usage`)
      .set('Cookie', mspOwner.sessionCookie);

    expect(usageRes.status).toBe(200);
    expect(usageRes.body.totals.total_clients).toBe(2);
    expect(usageRes.body.totals.total_events).toBe(2);
    expect(usageRes.body.totals.total_alerts).toBe(2);
    const acmeUsage = usageRes.body.clients.find((c: any) => c.client_name === 'Acme Corp');
    expect(acmeUsage.events_total).toBe(1);
    expect(acmeUsage.alerts_count).toBe(1);

    // Test 5: Consolidated executive report
    const reportRes = await request(app)
      .get(`/api/v1/organizations/${orgId}/reports/consolidated`)
      .set('Cookie', mspOwner.sessionCookie);

    expect(reportRes.status).toBe(200);
    expect(reportRes.body.report.summary.totalClientsMonitored).toBe(2);
    expect(reportRes.body.report.summary.totalAlertsGenerated).toBe(2);
  });
});
