import { describe, it, expect } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/pool.js';
import { config } from '../src/config/env.js';
import {
  normalizeFleetResponse,
  normalizeConsolidatedReport,
  normalizeUsageResponse,
} from '../../web/lib/api.js';

describe('MSP Fleet and Reports Data Resiliency & Error Recovery', () => {
  const app = createApp();

  const makeUser = async (label: string) => {
    const email = `fleet_rep_${label}_${crypto.randomBytes(4).toString('hex')}@example.com`;
    const password = 'Password123!';
    const regRes = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email,
        password,
        fullName: `Fleet Rep User ${label}`,
        workspaceName: `Fleet Rep Workspace ${label}`,
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

  it('1. should return empty fleet array structure when no agent servers exist', async () => {
    const owner = await makeUser('empty_fleet');

    const orgRes = await request(app)
      .post('/api/v1/organizations')
      .set('Cookie', owner.sessionCookie)
      .send({ name: 'Empty Fleet MSP' });
    const orgId = orgRes.body.organization.id;

    // Create a client workspace with zero servers
    await request(app)
      .post(`/api/v1/organizations/${orgId}/clients`)
      .set('Cookie', owner.sessionCookie)
      .send({ name: 'Empty Client' });

    const fleetRes = await request(app)
      .get(`/api/v1/organizations/${orgId}/fleet`)
      .set('Cookie', owner.sessionCookie);

    expect(fleetRes.status).toBe(200);
    expect(fleetRes.body.status).toBe('ok');
    expect(fleetRes.body.total_servers).toBe(0);
    expect(Array.isArray(fleetRes.body.servers)).toBe(true);
    expect(fleetRes.body.servers.length).toBe(0);
    expect(fleetRes.body.by_status).toEqual({
      connected: 0,
      degraded: 0,
      disconnected: 0,
      pending: 0,
      revoked: 0,
      inactive: 0,
    });
  });

  it('2. should return successful fleet response with servers and diagnostics', async () => {
    const owner = await makeUser('full_fleet');

    const orgRes = await request(app)
      .post('/api/v1/organizations')
      .set('Cookie', owner.sessionCookie)
      .send({ name: 'Active Fleet MSP' });
    const orgId = orgRes.body.organization.id;

    const clientRes = await request(app)
      .post(`/api/v1/organizations/${orgId}/clients`)
      .set('Cookie', owner.sessionCookie)
      .send({ name: 'Active Fleet Client' });
    const clientId = clientRes.body.client.id;

    // Seed an integration server
    const serverId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO integrations (id, workspace_id, name, integration_type, status, last_seen_at, metadata, created_by)
       VALUES ($1, $2, 'srv-prod-01', 'linux_auth', 'connected', NOW(), '{"agentMetadata":{"hostname":"srv-prod-01.internal","os":"Ubuntu 22.04","arch":"x86_64","agentVersion":"v1.2.0"}}'::jsonb, $3)`,
      [serverId, clientId, owner.userId]
    );

    const fleetRes = await request(app)
      .get(`/api/v1/organizations/${orgId}/fleet`)
      .set('Cookie', owner.sessionCookie);

    expect(fleetRes.status).toBe(200);
    expect(fleetRes.body.status).toBe('ok');
    expect(fleetRes.body.total_servers).toBe(1);
    expect(fleetRes.body.by_status.connected).toBe(1);
    expect(fleetRes.body.servers.length).toBe(1);

    const server = fleetRes.body.servers[0];
    expect(server.id).toBe(serverId);
    expect(server.name).toBe('srv-prod-01');
    expect(server.clientName).toBe('Active Fleet Client');
    expect(server.status).toBe('connected');
    expect(server.hostname).toBe('srv-prod-01.internal');
    expect(server.os).toBe('Ubuntu 22.04');
    expect(server.agentVersion).toBe('v1.2.0');
  });

  it('3. should enforce 403 on fleet and usage endpoints for unauthorized users', async () => {
    const owner = await makeUser('auth_owner');
    const attacker = await makeUser('unauthorized_attacker');

    const orgRes = await request(app)
      .post('/api/v1/organizations')
      .set('Cookie', owner.sessionCookie)
      .send({ name: 'Secured MSP Org' });
    const orgId = orgRes.body.organization.id;

    // Attacker tries to query fleet
    const fleetFailRes = await request(app)
      .get(`/api/v1/organizations/${orgId}/fleet`)
      .set('Cookie', attacker.sessionCookie);
    expect(fleetFailRes.status).toBe(403);

    // Attacker tries to query usage
    const usageFailRes = await request(app)
      .get(`/api/v1/organizations/${orgId}/usage`)
      .set('Cookie', attacker.sessionCookie);
    expect(usageFailRes.status).toBe(403);

    // Attacker tries to query consolidated report
    const reportFailRes = await request(app)
      .get(`/api/v1/organizations/${orgId}/reports/consolidated`)
      .set('Cookie', attacker.sessionCookie);
    expect(reportFailRes.status).toBe(403);
  });

  it('4. should return report with both totals and summary for executive consumption', async () => {
    const owner = await makeUser('rep_totals');

    const orgRes = await request(app)
      .post('/api/v1/organizations')
      .set('Cookie', owner.sessionCookie)
      .send({ name: 'Reporting MSP Corp' });
    const orgId = orgRes.body.organization.id;

    const clientRes = await request(app)
      .post(`/api/v1/organizations/${orgId}/clients`)
      .set('Cookie', owner.sessionCookie)
      .send({ name: 'Finance Client' });
    const clientId = clientRes.body.client.id;

    // Seed events & alerts
    await pool.query(
      `INSERT INTO security_events (id, tenant_id, source_type, source_host, occurred_at, observed_at, source_ip, event_type, severity, message, evidence, ingestion_source)
       VALUES ($1, $2, 'linux_auth', 'fin-srv', NOW(), NOW(), '192.168.1.50', 'ssh_login_failure', 'high', 'failed login', '{"outcome":"failure"}'::jsonb, 'live_agent')`,
      [crypto.randomUUID(), clientId]
    );

    await pool.query(
      `INSERT INTO alerts (workspace_id, rule_id, rule_version, rule_name, title, summary, reason, severity, status, fingerprint, first_event_at, last_event_at, event_count)
       VALUES ($1, 'r_fin', '1.0', 'fin_brute_force', 'Brute Force Alert', 'desc', 'reason', 'high', 'open', 'fp_${crypto.randomBytes(3).toString('hex')}', NOW(), NOW(), 1)`,
      [clientId]
    );

    const reportRes = await request(app)
      .get(`/api/v1/organizations/${orgId}/reports/consolidated`)
      .set('Cookie', owner.sessionCookie);

    expect(reportRes.status).toBe(200);
    expect(reportRes.body.status).toBe('ok');
    expect(reportRes.body.report).toBeDefined();

    // Verify summary contract
    const summary = reportRes.body.report.summary;
    expect(summary.totalClientsMonitored).toBe(1);
    expect(summary.totalEventsAnalyzed).toBe(1);
    expect(summary.totalAlertsGenerated).toBe(1);
    expect(summary.activeOpenAlerts).toBe(1);

    // Verify totals contract
    const totals = reportRes.body.report.totals;
    expect(totals).toBeDefined();
    expect(totals.clientsCount).toBe(1);
    expect(totals.totalEvents).toBe(1);
    expect(totals.totalAlerts).toBe(1);
    expect(totals.openAlerts).toBe(1);
    expect(typeof totals.activeServers).toBe('number');
    expect(typeof totals.totalServers).toBe('number');
    expect(typeof totals.aiInvestigations).toBe('number');
  });

  describe('Frontend Data Normalization & Resiliency Logic', () => {
    it('5. normalizeFleetResponse safely handles null, empty, servers array, and hosts array', () => {
      // Null / undefined handling
      const fromNull = normalizeFleetResponse(null);
      expect(Array.isArray(fromNull.hosts)).toBe(true);
      expect(fromNull.hosts.length).toBe(0);
      expect(fromNull.summary.totalServers).toBe(0);

      // Empty object handling
      const fromEmpty = normalizeFleetResponse({});
      expect(Array.isArray(fromEmpty.hosts)).toBe(true);
      expect(fromEmpty.hosts.length).toBe(0);

      // Backend API structure: { servers: [...] }
      const fromServers = normalizeFleetResponse({
        status: 'ok',
        total_servers: 2,
        by_status: { connected: 1, degraded: 1 },
        servers: [
          {
            id: 'srv-1',
            clientId: 'cl-1',
            clientName: 'Client One',
            name: 'bastion-01',
            status: 'connected',
            metadata: {
              agentMetadata: { hostname: 'bastion.internal', os: 'Linux', arch: 'x86_64', agentVersion: 'v1.0.0' },
            },
          },
          {
            id: 'srv-2',
            client_id: 'cl-2',
            client_name: 'Client Two',
            server_name: 'app-02',
            healthStatus: 'degraded',
          },
        ],
      });

      expect(Array.isArray(fromServers.hosts)).toBe(true);
      expect(fromServers.hosts.length).toBe(2);
      expect(fromServers.summary.connected).toBe(1);
      expect(fromServers.summary.degraded).toBe(1);
      expect(fromServers.hosts[0].hostname).toBe('bastion.internal');
      expect(fromServers.hosts[1].name).toBe('app-02');
      expect(fromServers.hosts[1].healthStatus).toBe('degraded');

      // Alternative structure: { hosts: [...] }
      const fromHosts = normalizeFleetResponse({
        hosts: [{ id: 'srv-3', name: 'host-3', status: 'connected' }],
      });
      expect(fromHosts.hosts.length).toBe(1);
      expect(fromHosts.hosts[0].name).toBe('host-3');
    });

    it('6. normalizeConsolidatedReport handles report with totals, missing totals, and malformed inputs', () => {
      // 1. Report with totals present
      const completeReport = {
        report: {
          reportType: 'Executive Summary',
          generatedAt: '2026-10-28T10:00:00Z',
          organization: { id: 'org-1', name: 'MSP Org', slug: 'msp-org' },
          totals: {
            clientsCount: 5,
            totalServers: 12,
            activeServers: 10,
            totalEvents: 45000,
            totalAlerts: 18,
            openAlerts: 3,
            aiInvestigations: 7,
          },
          summary: {
            totalClientsMonitored: 5,
            totalEventsAnalyzed: 45000,
            totalAlertsGenerated: 18,
            activeOpenAlerts: 3,
            totalActiveServers: 10,
          },
          clientDetails: [],
        },
      };

      const normalizedComplete = normalizeConsolidatedReport(completeReport);
      expect(normalizedComplete).not.toBeNull();
      expect(normalizedComplete!.totals.clientsCount).toBe(5);
      expect(normalizedComplete!.totals.activeServers).toBe(10);
      expect(normalizedComplete!.totals.totalServers).toBe(12);
      expect(normalizedComplete!.totals.totalEvents).toBe(45000);
      expect(normalizedComplete!.totals.aiInvestigations).toBe(7);

      // 2. Report with MISSING totals (e.g. legacy API returning only summary)
      const legacyReport = {
        report: {
          organization: { id: 'org-2', name: 'Legacy MSP' },
          summary: {
            totalClientsMonitored: 3,
            totalEventsAnalyzed: 12000,
            totalAlertsGenerated: 6,
            activeOpenAlerts: 1,
            totalActiveServers: 4,
          },
          clientDetails: [
            { clientId: 'c-1', active_servers: 2, total_events: 6000, total_alerts: 3, open_alerts: 1 },
            { clientId: 'c-2', active_servers: 2, total_events: 6000, total_alerts: 3, open_alerts: 0 },
          ],
        },
      };

      const normalizedLegacy = normalizeConsolidatedReport(legacyReport);
      expect(normalizedLegacy).not.toBeNull();
      // Totals should be derived safely from summary / clientDetails
      expect(normalizedLegacy!.totals.clientsCount).toBe(3);
      expect(normalizedLegacy!.totals.totalEvents).toBe(12000);
      expect(normalizedLegacy!.totals.activeServers).toBe(4);
      expect(normalizedLegacy!.totals.totalAlerts).toBe(6);
      expect(normalizedLegacy!.totals.openAlerts).toBe(1);
      expect(normalizedLegacy!.totals.aiInvestigations).toBe(0);

      // 3. Null / completely invalid input returns null safely without throwing
      expect(normalizeConsolidatedReport(null)).toBeNull();
      expect(normalizeConsolidatedReport(undefined)).toBeNull();
      expect(normalizeConsolidatedReport('string payload')).toBeNull();
      expect(normalizeConsolidatedReport({})).toBeNull();
    });

    it('7. normalizeUsageResponse handles flat and nested metrics, zero usage, and null inputs', () => {
      // Null input
      const fromNull = normalizeUsageResponse(null);
      expect(Array.isArray(fromNull.clients)).toBe(true);
      expect(fromNull.clients.length).toBe(0);
      expect(fromNull.totals.totalClients).toBe(0);

      // Complete usage response with backend structure
      const usageRes = normalizeUsageResponse({
        status: 'ok',
        totals: {
          total_clients: 2,
          total_events: 1500,
          total_events_24h: 300,
          total_datasets: 4,
          total_alerts: 5,
          total_cases: 2,
          total_ai_investigations: 1,
        },
        clients: [
          {
            client_id: 'cl-a',
            client_name: 'Client Alpha',
            client_slug: 'alpha',
            events_total: 1000,
            events_24h: 200,
            datasets_count: 3,
            alerts_count: 4,
            open_alerts: 1,
            cases_count: 2,
            ai_investigations_count: 1,
            active_servers: 3,
            total_servers: 4,
          },
          {
            clientId: 'cl-b',
            clientName: 'Client Beta',
            clientSlug: 'beta',
            metrics: {
              totalEvents: 500,
              eventsLast24h: 100,
              datasetsCount: 1,
              totalAlerts: 1,
              openAlerts: 0,
              totalCases: 0,
              aiInvestigationsCount: 0,
              activeServers: 1,
              totalServers: 1,
            },
          },
        ],
      });

      expect(usageRes.clients.length).toBe(2);
      expect(usageRes.totals.totalClients).toBe(2);
      expect(usageRes.totals.totalEvents).toBe(1500);

      // Client A (from flat backend keys)
      const a = usageRes.clients[0];
      expect(a.clientName).toBe('Client Alpha');
      expect(a.metrics.totalEvents).toBe(1000);
      expect(a.metrics.eventsLast24h).toBe(200);
      expect(a.metrics.openAlerts).toBe(1);
      expect(a.metrics.activeServers).toBe(3);
      expect(a.metrics.totalServers).toBe(4);

      // Client B (from nested metrics)
      const b = usageRes.clients[1];
      expect(b.clientName).toBe('Client Beta');
      expect(b.metrics.totalEvents).toBe(500);
      expect(b.metrics.activeServers).toBe(1);
    });
  });
});
