import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/pool.js';
import { datasetWorker } from '../src/services/dataset-worker.js';
import { config } from '../src/config/env.js';

describe('Processing Metadata and Security Event Classification Verification', () => {
  const app = createApp();

  beforeAll(async () => {
    datasetWorker.start();
  });

  afterAll(async () => {
    datasetWorker.stop();
  });

  async function registerAndVerifyUser(emailPrefix: string) {
    const email = `${emailPrefix}_${crypto.randomBytes(4).toString('hex')}@example.com`;
    const regRes = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email,
        password: 'StrongPassword123!',
        fullName: 'Metadata Tester',
        workspaceName: 'Metadata Test WS',
      });
    expect(regRes.status).toBe(201);

    const cookieHeader = regRes.headers['set-cookie'] as unknown as string[];
    const sessionCookie = cookieHeader
      .find((c: string) => c.startsWith(`${config.auth.sessionCookieName}=`))!
      .split(';')[0];
    const workspaceId = regRes.body.workspace.id as string;
    const userId = regRes.body.user.id as string;

    await pool.query('UPDATE users SET is_verified = TRUE WHERE id = $1', [userId]);

    return {
      userId,
      cookie: sessionCookie,
      workspaceId,
    };
  }

  it('persists unsupported_lines, skipped_lines, and parser_version, and verifies events uncertainty', async () => {
    const { cookie, workspaceId } = await registerAndVerifyUser('meta_user');

    // Mixed content:
    // Line 1: valid ssh login (BSD syslog with no year)
    // Line 2: blank (skipped)
    // Line 3: cron daemon (unsupported)
    // Line 4: another blank line (skipped)
    // Line 5: valid failed password
    const logContent = [
      'Oct 24 10:14:22 test-host sshd[1234]: Accepted password for root from 192.168.1.100 port 2222 ssh2',
      '',
      'Oct 24 10:15:00 test-host CRON[5678]: (root) CMD (/usr/bin/backup)',
      '   ',
      'Oct 24 10:16:00 test-host sshd[1235]: Failed password for invalid user admin from 10.0.0.1 port 3333 ssh2',
      '',
    ].join('\n');

    const uploadRes = await request(app)
      .post(`/api/v1/workspaces/${workspaceId}/datasets`)
      .set('Cookie', cookie)
      .attach('file', Buffer.from(logContent, 'utf-8'), 'mixed-telemetry.log');

    expect(uploadRes.status).toBe(201);
    const datasetId = uploadRes.body.dataset.id;

    // Trigger worker tick and wait for completion
    datasetWorker.triggerImmediate();

    let completed = false;
    for (let i = 0; i < 20; i++) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      const statusRes = await request(app)
        .get(`/api/v1/workspaces/${workspaceId}/datasets/${datasetId}`)
        .set('Cookie', cookie);

      if (statusRes.body.dataset?.status === 'completed') {
        completed = true;
        const ds = statusRes.body.dataset;
        // Total non-blank lines = 3 (1 valid + 1 unsupported + 1 valid)
        expect(ds.totalLines).toBe(3);
        expect(ds.validLines).toBe(2);
        expect(ds.unsupportedLines).toBe(1);
        expect(ds.skippedLines).toBe(2);
        expect(ds.parserVersion).toBe('0.1.0');
        break;
      }
    }
    expect(completed).toBe(true);

    // Verify dataset listing endpoint returns metadata fields
    const listRes = await request(app)
      .get(`/api/v1/workspaces/${workspaceId}/datasets`)
      .set('Cookie', cookie);
    expect(listRes.status).toBe(200);
    const listedDs = listRes.body.datasets.find((d: any) => d.id === datasetId);
    expect(listedDs).toBeDefined();
    expect(listedDs.unsupportedLines).toBe(1);
    expect(listedDs.skippedLines).toBe(2);
    expect(listedDs.parserVersion).toBe('0.1.0');

    // Verify workspace events include dataset_id and evidence timestamp uncertainty details
    const eventsRes = await request(app)
      .get(`/api/v1/workspaces/${workspaceId}/events`)
      .set('Cookie', cookie);
    expect(eventsRes.status).toBe(200);
    expect(eventsRes.body.events.length).toBe(2);

    const firstEvt = eventsRes.body.events[0];
    expect(firstEvt.dataset_id).toBe(datasetId);
    expect(firstEvt.evidence).toBeDefined();
    expect(firstEvt.evidence.timestamp_uncertain).toBe(true);
    expect(firstEvt.evidence.inferred_year).toBeDefined();
    expect(firstEvt.evidence.inferred_timezone).toBe(true);
    expect(firstEvt.evidence.timezone_assumption).toBe('UTC (omitted in BSD syslog)');
  });
});
