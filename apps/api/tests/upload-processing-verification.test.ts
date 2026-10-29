import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { createApp } from '../src/app.js';
import { datasetWorker } from '../src/services/dataset-worker.js';
import { pool } from '../src/database/pool.js';
import { config } from '../src/config/env.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../../');

describe('End-to-End Real Upload & Ingestion Verification', () => {
  const app = createApp();

  beforeAll(() => {
    datasetWorker.start();
  });

  afterAll(() => {
    datasetWorker.stop();
  });

  it('uploads fixtures/linux-auth/ssh-success.log, transitions queued -> processing -> completed, persists events, and returns visible records on page refresh', async () => {
    // 1. Create a verified owner user and workspace
    const email = `upload_e2e_${crypto.randomBytes(4).toString('hex')}@example.com`;
    const regRes = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email,
        password: 'Password123!',
        fullName: 'Upload Tester',
        workspaceName: 'Upload Test Workspace',
      });

    expect(regRes.status).toBe(201);
    const cookieHeader = regRes.headers['set-cookie'] as unknown as string[];
    const sessionCookie = cookieHeader
      .find((c: string) => c.startsWith(`${config.auth.sessionCookieName}=`))!
      .split(';')[0];
    const workspaceId = regRes.body.workspace.id as string;
    const userId = regRes.body.user.id as string;

    await pool.query('UPDATE users SET is_verified = TRUE WHERE id = $1', [userId]);

    // 2. Read real fixture file
    const fixturePath = path.resolve(repoRoot, 'fixtures/linux-auth/ssh-success.log');
    expect(fs.existsSync(fixturePath)).toBe(true);
    const fixtureBuffer = fs.readFileSync(fixturePath);

    // 3. Upload dataset
    const uploadRes = await request(app)
      .post(`/api/v1/workspaces/${workspaceId}/datasets`)
      .set('Cookie', sessionCookie)
      .attach('file', fixtureBuffer, 'ssh-success.log');

    expect(uploadRes.status).toBe(201);
    expect(uploadRes.body.dataset).toBeDefined();
    const datasetId = uploadRes.body.dataset.id;
    expect(uploadRes.body.dataset.status).toBe('queued');
    expect(uploadRes.body.dataset.originalFilename).toBe('ssh-success.log');

    // 4. Poll until completed (simulating web frontend polling interval)
    let isCompleted = false;
    let finalDataset = null;
    const startTime = Date.now();

    while (Date.now() - startTime < 15000) {
      datasetWorker.triggerImmediate();
      await new Promise((r) => setTimeout(r, 300));

      const pollRes = await request(app)
        .get(`/api/v1/workspaces/${workspaceId}/datasets/${datasetId}`)
        .set('Cookie', sessionCookie);

      expect(pollRes.status).toBe(200);
      const ds = pollRes.body.dataset;
      if (ds.status === 'completed') {
        isCompleted = true;
        finalDataset = ds;
        break;
      }
      if (ds.status === 'failed') {
        throw new Error(`Dataset failed unexpectedly: ${ds.errorMessage || 'unknown error'}`);
      }
    }

    expect(isCompleted).toBe(true);
    expect(finalDataset).toBeDefined();
    expect(finalDataset.status).toBe('completed');
    expect(finalDataset.totalLines).toBe(4);
    expect(finalDataset.validLines).toBe(4);
    expect(finalDataset.malformedLines).toBe(0);

    // 5. Query workspace events (simulating workspace events tab on page load/refresh)
    const eventsRes = await request(app)
      .get(`/api/v1/workspaces/${workspaceId}/events`)
      .set('Cookie', sessionCookie);

    expect(eventsRes.status).toBe(200);
    expect(eventsRes.body.total).toBe(4);
    expect(eventsRes.body.events.length).toBe(4);

    const eventTypes = eventsRes.body.events.map((e: { event_type: string }) => e.event_type);
    expect(eventTypes).toContain('ssh_login_success');
    expect(eventTypes).toContain('session_opened');

    // 6. Query datasets list (simulating workspace datasets tab on page load/refresh)
    const listRes = await request(app)
      .get(`/api/v1/workspaces/${workspaceId}/datasets`)
      .set('Cookie', sessionCookie);

    expect(listRes.status).toBe(200);
    expect(listRes.body.datasets.length).toBe(1);
    expect(listRes.body.datasets[0].id).toBe(datasetId);
    expect(listRes.body.datasets[0].status).toBe('completed');
    expect(listRes.body.datasets[0].validLines).toBe(4);
  });

  it('uploads auth.log from root, processes without require is not defined error, and saves canonical events', async () => {
    const authLogPath = path.resolve(repoRoot, 'auth.log');
    if (!fs.existsSync(authLogPath)) {
      return;
    }

    const email = `upload_authlog_${crypto.randomBytes(4).toString('hex')}@example.com`;
    const regRes = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email,
        password: 'Password123!',
        fullName: 'Auth Log Tester',
        workspaceName: 'Auth Log Workspace',
      });

    const cookieHeader = regRes.headers['set-cookie'] as unknown as string[];
    const sessionCookie = cookieHeader
      .find((c: string) => c.startsWith(`${config.auth.sessionCookieName}=`))!
      .split(';')[0];
    const workspaceId = regRes.body.workspace.id as string;
    const userId = regRes.body.user.id as string;

    await pool.query('UPDATE users SET is_verified = TRUE WHERE id = $1', [userId]);

    const authLogBuffer = fs.readFileSync(authLogPath);
    const uploadRes = await request(app)
      .post(`/api/v1/workspaces/${workspaceId}/datasets`)
      .set('Cookie', sessionCookie)
      .attach('file', authLogBuffer, 'auth.log');

    expect(uploadRes.status).toBe(201);
    const datasetId = uploadRes.body.dataset.id;

    let isCompleted = false;
    let finalDataset = null;
    const startTime = Date.now();

    while (Date.now() - startTime < 15000) {
      datasetWorker.triggerImmediate();
      await new Promise((r) => setTimeout(r, 300));

      const pollRes = await request(app)
        .get(`/api/v1/workspaces/${workspaceId}/datasets/${datasetId}`)
        .set('Cookie', sessionCookie);

      const ds = pollRes.body.dataset;
      if (ds.status === 'completed') {
        isCompleted = true;
        finalDataset = ds;
        break;
      }
      if (ds.status === 'failed') {
        throw new Error(`Dataset failed unexpectedly: ${ds.errorMessage || 'unknown error'}`);
      }
    }

    expect(isCompleted).toBe(true);
    expect(finalDataset).toBeDefined();
    expect(finalDataset.status).toBe('completed');
    expect(finalDataset.totalLines).toBe(3);
    expect(finalDataset.validLines).toBe(3);

    const eventsRes = await request(app)
      .get(`/api/v1/workspaces/${workspaceId}/events`)
      .set('Cookie', sessionCookie);

    expect(eventsRes.status).toBe(200);
    expect(eventsRes.body.total).toBe(3);
  });
});
