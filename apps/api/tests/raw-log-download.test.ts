import { describe, it, expect } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/pool.js';
import { config } from '../src/config/env.js';
import { storageService } from '../src/services/storage.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../../');

describe('Raw Log Download Endpoint & Authorization Security', () => {
  const app = createApp();

  const makeUser = async (roleLabel: string, verified = true) => {
    const email = `rawlog_${roleLabel}_${crypto.randomBytes(4).toString('hex')}@example.com`;
    const password = 'StrongPassword123!';
    const regRes = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email,
        password,
        fullName: `User ${roleLabel}`,
        workspaceName: `Workspace ${roleLabel}`,
      });

    const cookieHeader = regRes.headers['set-cookie'] as unknown as string[];
    const sessionCookie = cookieHeader
      .find((c: string) => c.startsWith(`${config.auth.sessionCookieName}=`))!
      .split(';')[0];

    if (verified) {
      await pool.query('UPDATE users SET is_verified = TRUE WHERE id = $1', [regRes.body.user.id]);
    }

    return {
      userId: regRes.body.user.id as string,
      email,
      workspaceId: regRes.body.workspace.id as string,
      sessionCookie,
    };
  };

  const addMemberWithRole = async (ownerCookie: string, workspaceId: string, email: string, role: string) => {
    return request(app)
      .post(`/api/v1/workspaces/${workspaceId}/members`)
      .set('Cookie', ownerCookie)
      .send({ email, role });
  };

  describe('Authorized Access & Content Delivery', () => {
    it('allows workspace owner to download raw log with safe headers and exact content', async () => {
      const owner = await makeUser('Owner');
      const fixturePath = path.resolve(repoRoot, 'fixtures/linux-auth/ssh-success.log');
      const fixtureContent = fs.readFileSync(fixturePath, 'utf-8');

      // Upload dataset
      const uploadRes = await request(app)
        .post(`/api/v1/workspaces/${owner.workspaceId}/datasets`)
        .set('Cookie', owner.sessionCookie)
        .attach('file', Buffer.from(fixtureContent), 'ssh-success.log');

      expect(uploadRes.status).toBe(201);
      const datasetId = uploadRes.body.dataset.id;

      // Download raw log
      const downloadRes = await request(app)
        .get(`/api/v1/workspaces/${owner.workspaceId}/datasets/${datasetId}/raw`)
        .set('Cookie', owner.sessionCookie);

      expect(downloadRes.status).toBe(200);
      expect(downloadRes.headers['content-type']).toBe('text/plain; charset=utf-8');
      expect(downloadRes.headers['content-disposition']).toContain('attachment');
      expect(downloadRes.headers['content-disposition']).toContain('filename="ssh-success.log"');
      expect(downloadRes.headers['cache-control']).toContain('private');
      expect(downloadRes.headers['cache-control']).toContain('no-store');
      expect(downloadRes.headers['x-content-type-options']).toBe('nosniff');
      expect(downloadRes.text).toBe(fixtureContent);
    });

    it('allows workspace viewer to download raw log file', async () => {
      const owner = await makeUser('OwnerWithViewer');
      const viewer = await makeUser('ViewerUser');

      await addMemberWithRole(owner.sessionCookie, owner.workspaceId, viewer.email, 'viewer');

      const fixtureContent = 'Oct 24 10:14:22 bastion sshd[14201]: Accepted publickey for viewer from 192.0.2.1\n';
      const uploadRes = await request(app)
        .post(`/api/v1/workspaces/${owner.workspaceId}/datasets`)
        .set('Cookie', owner.sessionCookie)
        .attach('file', Buffer.from(fixtureContent), 'viewer-test.log');

      expect(uploadRes.status).toBe(201);
      const datasetId = uploadRes.body.dataset.id;

      // Viewer downloads raw log
      const downloadRes = await request(app)
        .get(`/api/v1/workspaces/${owner.workspaceId}/datasets/${datasetId}/raw`)
        .set('Cookie', viewer.sessionCookie);

      expect(downloadRes.status).toBe(200);
      expect(downloadRes.text).toBe(fixtureContent);
    });

    it('serves inline disposition when requested via query parameter', async () => {
      const owner = await makeUser('InlineQuery');
      const fixtureContent = 'Oct 24 10:14:22 bastion sshd: sample log\n';
      const uploadRes = await request(app)
        .post(`/api/v1/workspaces/${owner.workspaceId}/datasets`)
        .set('Cookie', owner.sessionCookie)
        .attach('file', Buffer.from(fixtureContent), 'inline.log');

      const datasetId = uploadRes.body.dataset.id;

      const downloadRes = await request(app)
        .get(`/api/v1/workspaces/${owner.workspaceId}/datasets/${datasetId}/raw?inline=true`)
        .set('Cookie', owner.sessionCookie);

      expect(downloadRes.status).toBe(200);
      expect(downloadRes.headers['content-disposition']).toContain('inline');
      expect(downloadRes.headers['content-disposition']).toContain('filename="inline.log"');
    });
  });

  describe('Unauthenticated & Unauthorized Access Control', () => {
    it('rejects unauthenticated requests with 401 Unauthorized', async () => {
      const owner = await makeUser('UnauthTest');
      const uploadRes = await request(app)
        .post(`/api/v1/workspaces/${owner.workspaceId}/datasets`)
        .set('Cookie', owner.sessionCookie)
        .attach('file', Buffer.from('Oct 24 bastion sshd: test entry\n'), 'unauth.log');

      const datasetId = uploadRes.body.dataset.id;

      // No cookie set
      const downloadRes = await request(app)
        .get(`/api/v1/workspaces/${owner.workspaceId}/datasets/${datasetId}/raw`);

      expect(downloadRes.status).toBe(401);
      expect(downloadRes.body.error).toBe('Unauthorized');
      expect(downloadRes.text).not.toContain('storage');
    });

    it('prevents cross-workspace IDOR data access (Workspace B user accessing Dataset A in Workspace B route)', async () => {
      const ownerA = await makeUser('CrossA');
      const ownerB = await makeUser('CrossB');

      const uploadResA = await request(app)
        .post(`/api/v1/workspaces/${ownerA.workspaceId}/datasets`)
        .set('Cookie', ownerA.sessionCookie)
        .attach('file', Buffer.from('Oct 24 bastion sshd: secret logs of A\n'), 'secret-a.log');

      const datasetIdA = uploadResA.body.dataset.id;

      // Owner B attempts to download Dataset A through Workspace B's route
      const downloadRes = await request(app)
        .get(`/api/v1/workspaces/${ownerB.workspaceId}/datasets/${datasetIdA}/raw`)
        .set('Cookie', ownerB.sessionCookie);

      expect(downloadRes.status).toBe(404);
      expect(downloadRes.body.error).toBe('Not Found');
      expect(downloadRes.text).not.toContain('secret logs of A');
    });

    it('prevents non-member from accessing another workspace route with 403 Forbidden', async () => {
      const ownerA = await makeUser('NonMemberOwner');
      const userC = await makeUser('NonMemberStranger');

      const uploadResA = await request(app)
        .post(`/api/v1/workspaces/${ownerA.workspaceId}/datasets`)
        .set('Cookie', ownerA.sessionCookie)
        .attach('file', Buffer.from('Oct 24 bastion sshd: sensitive entry\n'), 'private-workspace.log');

      const datasetIdA = uploadResA.body.dataset.id;

      // Stranger tries to access Workspace A route directly
      const downloadRes = await request(app)
        .get(`/api/v1/workspaces/${ownerA.workspaceId}/datasets/${datasetIdA}/raw`)
        .set('Cookie', userC.sessionCookie);

      expect(downloadRes.status).toBe(403);
      expect(downloadRes.body.error).toBe('Forbidden');
      expect(downloadRes.text).not.toContain('sensitive entry');
    });
  });

  describe('Missing Dataset & Missing Storage File Handling', () => {
    it('returns 404 Not Found for non-existent dataset UUID', async () => {
      const owner = await makeUser('MissingDataset');
      const randomUuid = crypto.randomUUID();

      const downloadRes = await request(app)
        .get(`/api/v1/workspaces/${owner.workspaceId}/datasets/${randomUuid}/raw`)
        .set('Cookie', owner.sessionCookie);

      expect(downloadRes.status).toBe(404);
      expect(downloadRes.body.error).toBe('Not Found');
      expect(downloadRes.body.message).toBe('Dataset not found.');
    });

    it('returns 404 Not Found for invalid non-UUID dataset id', async () => {
      const owner = await makeUser('InvalidDatasetId');

      const downloadRes = await request(app)
        .get(`/api/v1/workspaces/${owner.workspaceId}/datasets/not-a-valid-uuid/raw`)
        .set('Cookie', owner.sessionCookie);

      expect(downloadRes.status).toBe(404);
      expect(downloadRes.body.error).toBe('Not Found');
      expect(downloadRes.body.message).toBe('Dataset not found.');
    });

    it('returns 404 Not Found without leaking filesystem paths when physical file is missing from private storage', async () => {
      const owner = await makeUser('MissingPhysicalFile');

      // 1. Upload dataset
      const uploadRes = await request(app)
        .post(`/api/v1/workspaces/${owner.workspaceId}/datasets`)
        .set('Cookie', owner.sessionCookie)
        .attach('file', Buffer.from('Oct 24 test file\n'), 'will-be-deleted.log');

      const datasetId = uploadRes.body.dataset.id;

      // 2. Query storage_key from DB
      const dsRes = await pool.query(
        'SELECT storage_key FROM datasets WHERE id = $1',
        [datasetId]
      );
      const storageKey = dsRes.rows[0].storage_key;

      // 3. Delete physical file from storage simulating storage loss
      await storageService.deleteFile(owner.workspaceId, storageKey);
      const exists = await storageService.fileExists(owner.workspaceId, storageKey);
      expect(exists).toBe(false);

      // 4. Request raw download
      const downloadRes = await request(app)
        .get(`/api/v1/workspaces/${owner.workspaceId}/datasets/${datasetId}/raw`)
        .set('Cookie', owner.sessionCookie);

      expect(downloadRes.status).toBe(404);
      expect(downloadRes.body.error).toBe('Not Found');
      expect(downloadRes.body.message).toBe('Raw log file not found in storage.');
      // Confirm no absolute server paths leaked
      expect(downloadRes.text).not.toContain('D:');
      expect(downloadRes.text).not.toContain('/storage/');
      expect(downloadRes.text).not.toContain('\\storage\\');
      expect(downloadRes.text).not.toContain('\\workspaces\\');
    });
  });
});
