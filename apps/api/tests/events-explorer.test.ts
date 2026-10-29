import { describe, it, expect } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/pool.js';
import { config } from '../src/config/env.js';

describe('Security Events Explorer API Verification', () => {
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

  it('searches events by multi-field substring, filters by specific fields and time range, and paginates deterministically', async () => {
    const { workspaceId, cookie } = await makeUserAndWorkspace('ev_exp');

    // Insert 6 security events spaced across time
    const baseTime = new Date('2026-10-26T10:00:00Z').getTime();
    const eventIds: string[] = [];

    const testEvents = [
      {
        host: 'bastion-01',
        type: 'ssh_login_failure',
        sev: 'medium',
        time: new Date(baseTime + 1000).toISOString(),
        user: 'attacker_one',
        ip: '198.51.100.10',
        msg: 'Failed password for invalid user attacker_one',
      },
      {
        host: 'bastion-01',
        type: 'ssh_login_failure',
        sev: 'medium',
        time: new Date(baseTime + 2000).toISOString(),
        user: 'attacker_two',
        ip: '198.51.100.10',
        msg: 'Failed password for attacker_two',
      },
      {
        host: 'web-prod-02',
        type: 'ssh_login_success',
        sev: 'info',
        time: new Date(baseTime + 3000).toISOString(),
        user: 'deploy_bot',
        ip: '10.0.1.5',
        msg: 'Accepted publickey for deploy_bot from 10.0.1.5',
      },
      {
        host: 'database-master',
        type: 'sudo_command',
        sev: 'high',
        time: new Date(baseTime + 4000).toISOString(),
        user: 'admin_dave',
        ip: '10.0.2.20',
        msg: 'admin_dave : COMMAND=/bin/systemctl restart postgresql',
      },
      {
        host: 'database-master',
        type: 'privilege_escalation',
        sev: 'critical',
        time: new Date(baseTime + 5000).toISOString(),
        user: 'root',
        ip: '10.0.2.20',
        msg: 'session opened for user root by admin_dave',
      },
      {
        host: 'app-gateway',
        type: 'invalid_user_probe',
        sev: 'high',
        time: new Date(baseTime + 6000).toISOString(),
        user: 'oracle',
        ip: '203.0.113.88',
        msg: 'Invalid user probe attempt for user oracle',
      },
    ];

    for (const te of testEvents) {
      const insRes = await pool.query(
        `INSERT INTO security_events (
          tenant_id, source_type, source_host, event_type, severity, occurred_at, username, source_ip, message, evidence, ingestion_source
        ) VALUES ($1, 'linux_auth', $2, $3, $4, $5, $6, $7, $8, '{"auth_method": "password"}'::jsonb, 'test')
        RETURNING id;`,
        [workspaceId, te.host, te.type, te.sev, te.time, te.user, te.ip, te.msg]
      );
      eventIds.push(insRes.rows[0].id);
    }

    // 1. Search by keyword across user, host, IP, or message
    const searchRes = await request(app)
      .get(`/api/v1/workspaces/${workspaceId}/events?search=oracle`)
      .set('Cookie', cookie);
    expect(searchRes.status).toBe(200);
    expect(searchRes.body.total).toBe(1);
    expect(searchRes.body.events[0].username).toBe('oracle');
    expect(searchRes.body.events[0].source_host).toBe('app-gateway');

    // Search by IP
    const searchIpRes = await request(app)
      .get(`/api/v1/workspaces/${workspaceId}/events?search=198.51.100.10`)
      .set('Cookie', cookie);
    expect(searchIpRes.status).toBe(200);
    expect(searchIpRes.body.total).toBe(2);

    // 2. Filter by severity
    const sevRes = await request(app)
      .get(`/api/v1/workspaces/${workspaceId}/events?severity=critical`)
      .set('Cookie', cookie);
    expect(sevRes.status).toBe(200);
    expect(sevRes.body.total).toBe(1);
    expect(sevRes.body.events[0].severity).toBe('critical');
    expect(sevRes.body.events[0].username).toBe('root');

    // 3. Filter by event_type
    const typeRes = await request(app)
      .get(`/api/v1/workspaces/${workspaceId}/events?event_type=sudo_command`)
      .set('Cookie', cookie);
    expect(typeRes.status).toBe(200);
    expect(typeRes.body.total).toBe(1);
    expect(typeRes.body.events[0].event_type).toBe('sudo_command');

    // 4. Filter by specific host
    const hostRes = await request(app)
      .get(`/api/v1/workspaces/${workspaceId}/events?source_host=database-master`)
      .set('Cookie', cookie);
    expect(hostRes.status).toBe(200);
    expect(hostRes.body.total).toBe(2);

    // 5. Filter by time range (from, to)
    const fromTime = new Date(baseTime + 2500).toISOString();
    const toTime = new Date(baseTime + 5500).toISOString();
    const timeRes = await request(app)
      .get(`/api/v1/workspaces/${workspaceId}/events?from=${encodeURIComponent(fromTime)}&to=${encodeURIComponent(toTime)}`)
      .set('Cookie', cookie);
    expect(timeRes.status).toBe(200);
    expect(timeRes.body.total).toBe(3); // events at +3000, +4000, +5000

    // 6. Pagination & deterministic ordering (occurred_at DESC, id DESC)
    const page1Res = await request(app)
      .get(`/api/v1/workspaces/${workspaceId}/events?limit=2&page=1`)
      .set('Cookie', cookie);
    expect(page1Res.status).toBe(200);
    expect(page1Res.body.total).toBe(6);
    expect(page1Res.body.limit).toBe(2);
    expect(page1Res.body.offset).toBe(0);
    expect(page1Res.body.page).toBe(1);
    expect(page1Res.body.totalPages).toBe(3);
    expect(page1Res.body.events.length).toBe(2);
    // Newest first (+6000 then +5000)
    expect(page1Res.body.events[0].username).toBe('oracle');
    expect(page1Res.body.events[1].username).toBe('root');

    const page2Res = await request(app)
      .get(`/api/v1/workspaces/${workspaceId}/events?limit=2&page=2`)
      .set('Cookie', cookie);
    expect(page2Res.status).toBe(200);
    expect(page2Res.body.events.length).toBe(2);
    expect(page2Res.body.page).toBe(2);
    // Next newest (+4000 then +3000)
    expect(page2Res.body.events[0].username).toBe('admin_dave');
    expect(page2Res.body.events[1].username).toBe('deploy_bot');
  });

  it('fetches single event by ID and prevents IDOR cross-tenant access', async () => {
    const wsA = await makeUserAndWorkspace('ev_lookup_a');
    const wsB = await makeUserAndWorkspace('ev_lookup_b');

    // Insert event into Workspace A
    const insRes = await pool.query(
      `INSERT INTO security_events (
        tenant_id, source_type, source_host, event_type, severity, occurred_at, username, source_ip, message, evidence, ingestion_source
      ) VALUES ($1, 'linux_auth', 'host-alpha', 'ssh_login_success', 'info', NOW(), 'charlie', '192.168.1.50', 'Success login', '{"line_number": 42}'::jsonb, 'test')
      RETURNING id;`,
      [wsA.workspaceId]
    );
    const eventId = insRes.rows[0].id;

    // 1. Authorized lookup in Workspace A
    const okRes = await request(app)
      .get(`/api/v1/workspaces/${wsA.workspaceId}/events/${eventId}`)
      .set('Cookie', wsA.cookie);
    expect(okRes.status).toBe(200);
    expect(okRes.body.status).toBe('ok');
    expect(okRes.body.event.id).toBe(eventId);
    expect(okRes.body.event.username).toBe('charlie');
    expect(okRes.body.event.evidence.line_number).toBe(42);

    // 2. Non-existent event returns 404
    const notFoundRes = await request(app)
      .get(`/api/v1/workspaces/${wsA.workspaceId}/events/00000000-0000-0000-0000-000000000000`)
      .set('Cookie', wsA.cookie);
    expect(notFoundRes.status).toBe(404);

    // 3. IDOR: Querying event from another workspace returns 404
    const idorRes = await request(app)
      .get(`/api/v1/workspaces/${wsB.workspaceId}/events/${eventId}`)
      .set('Cookie', wsB.cookie);
    expect(idorRes.status).toBe(404);
  });
});

