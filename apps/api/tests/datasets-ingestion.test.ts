import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/pool.js';
import { config } from '../src/config/env.js';
import { validateLogFile, sanitizeFilename } from '../src/services/file-validator.js';
import { storageService } from '../src/services/storage.js';
import { datasetWorker } from '../src/services/dataset-worker.js';

describe('Log Ingestion Pipeline, Background Processing & Storage Security', () => {
  const app = createApp();

  beforeAll(() => {
    // Start background processing worker for automated tests
    datasetWorker.start();
  });

  afterAll(() => {
    datasetWorker.stop();
  });

  const makeUser = async (roleLabel: string, verified = true) => {
    const email = `ds_user_${roleLabel}_${crypto.randomBytes(4).toString('hex')}@example.com`;
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
    const sessionCookie = cookieHeader.find((c: string) => c.startsWith(`${config.auth.sessionCookieName}=`))!.split(';')[0];

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

  describe('File Validation Service & Security Bounds', () => {
    it('sanitizes dangerous filenames preventing path traversal', () => {
      expect(sanitizeFilename('../../../etc/passwd.log')).toBe('passwd.log');
      expect(sanitizeFilename('..\\..\\windows\\system32\\calc.txt')).toBe('calc.txt');
      expect(sanitizeFilename('safe-log-file_2026.log')).toBe('safe-log-file_2026.log');
      expect(sanitizeFilename('my log file!@#$.log')).toBe('my_log_file____.log');
    });

    it('rejects unsupported file extensions', () => {
      const res = validateLogFile(Buffer.from('Oct 24 test auth log'), 'exploit.tar.gz');
      expect(res.valid).toBe(false);
      if (!res.valid) {
        expect(res.errorCode).toBe('UNSUPPORTED_EXTENSION');
      }
    });

    it('rejects empty files (0 bytes)', () => {
      const res = validateLogFile(Buffer.alloc(0), 'empty.log');
      expect(res.valid).toBe(false);
      if (!res.valid) {
        expect(res.errorCode).toBe('FILE_EMPTY');
      }
    });

    it('rejects whitespace-only files', () => {
      const res = validateLogFile(Buffer.from('   \n\n\t  \r\n   '), 'spaces.log');
      expect(res.valid).toBe(false);
      if (!res.valid) {
        expect(res.errorCode).toBe('FILE_EMPTY');
      }
    });

    it('rejects files containing null bytes or binary content', () => {
      const binaryBuf = Buffer.from([0x4f, 0x63, 0x74, 0x00, 0x32, 0x34]); // "Oct\0 24"
      const res = validateLogFile(binaryBuf, 'binary.log');
      expect(res.valid).toBe(false);
      if (!res.valid) {
        expect(res.errorCode).toBe('INVALID_ENCODING_OR_BINARY');
      }
    });

    it('rejects invalid UTF-8 byte sequences', () => {
      // 0xFF 0xFE is an invalid UTF-8 sequence
      const invalidUtf8 = Buffer.from([0xff, 0xfe, 0xd8, 0x00]);
      const res = validateLogFile(invalidUtf8, 'bad-utf8.log');
      expect(res.valid).toBe(false);
      if (!res.valid) {
        expect(res.errorCode).toBe('INVALID_ENCODING_OR_BINARY');
      }
    });

    it('rejects log lines exceeding 16 KiB limit', () => {
      const giantLine = 'Oct 24 10:14:22 host sshd: ' + 'A'.repeat(16385);
      const res = validateLogFile(Buffer.from(giantLine), 'giant-line.log');
      expect(res.valid).toBe(false);
      if (!res.valid) {
        expect(res.errorCode).toBe('LINE_OVERLONG');
      }
    });

    it('accepts valid plain-text log records and computes SHA-256', () => {
      const validLog = 'Oct 24 10:14:22 bastion sshd[14201]: Accepted publickey for deploy from 192.0.2.10 port 49152 ssh2\n';
      const res = validateLogFile(Buffer.from(validLog), 'valid.log');
      expect(res.valid).toBe(true);
      if (res.valid) {
        expect(res.sha256).toBeDefined();
        expect(res.sha256.length).toBe(64);
        expect(res.nonEmptyLines).toBe(1);
      }
    });
  });

  describe('Upload Endpoint & Duplicate-Prevention Policy', () => {
    it('rejects unauthenticated upload requests', async () => {
      const res = await request(app)
        .post('/api/v1/workspaces/11111111-1111-1111-1111-111111111111/datasets')
        .attach('file', Buffer.from('test log line'), 'test.log');

      expect(res.status).toBe(401);
    });

    it('rejects uploads from unverified user accounts', async () => {
      const unverifiedUser = await makeUser('Unverified', false);

      const res = await request(app)
        .post(`/api/v1/workspaces/${unverifiedUser.workspaceId}/datasets`)
        .set('Cookie', unverifiedUser.sessionCookie)
        .attach('file', Buffer.from('Oct 24 bastion sshd: Accepted password'), 'test.log');

      expect(res.status).toBe(403);
      expect(res.body.verificationRequired).toBe(true);
    });

    it('rejects uploads when file is missing', async () => {
      const owner = await makeUser('OwnerMissFile');

      const res = await request(app)
        .post(`/api/v1/workspaces/${owner.workspaceId}/datasets`)
        .set('Cookie', owner.sessionCookie);

      expect(res.status).toBe(400);
      expect(res.body.errorCode).toBe('FILE_MISSING');
    });

    it('rejects uploads with unsupported file extension', async () => {
      const owner = await makeUser('OwnerBadExt');

      const res = await request(app)
        .post(`/api/v1/workspaces/${owner.workspaceId}/datasets`)
        .set('Cookie', owner.sessionCookie)
        .attach('file', Buffer.from('PDF header dummy'), 'telemetry.pdf');

      expect(res.status).toBe(400);
      expect(res.body.errorCode).toBe('UNSUPPORTED_EXTENSION');
    });

    it('accepts valid fixture upload and enqueues processing job', async () => {
      const owner = await makeUser('OwnerValid');
      const fixtureContent = 'Oct 24 10:14:22 bastion-01 sshd[14201]: Accepted publickey for deploy from 192.0.2.10 port 49152 ssh2: RSA SHA256:abc\n';

      const res = await request(app)
        .post(`/api/v1/workspaces/${owner.workspaceId}/datasets`)
        .set('Cookie', owner.sessionCookie)
        .attach('file', Buffer.from(fixtureContent), 'auth.log');

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('created');
      expect(res.body.dataset.id).toBeDefined();
      expect(res.body.dataset.status).toBe('queued');
      expect(res.body.dataset.originalFilename).toBe('auth.log');

      // Verify dataset stored in DB
      const dsDb = await pool.query('SELECT status, file_sha256 FROM datasets WHERE id = $1', [res.body.dataset.id]);
      expect(dsDb.rows.length).toBe(1);

      // Verify job enqueued
      const jobDb = await pool.query('SELECT status FROM processing_jobs WHERE dataset_id = $1', [res.body.dataset.id]);
      expect(jobDb.rows.length).toBe(1);
    });

    it('enforces duplicate detection within the same workspace', async () => {
      const owner = await makeUser('OwnerDup');
      const uniqueContent = `Oct 24 10:14:22 bastion sshd: Accepted password for user_${crypto.randomBytes(3).toString('hex')} from 192.0.2.10 port 22\n`;

      // First upload: OK
      const firstRes = await request(app)
        .post(`/api/v1/workspaces/${owner.workspaceId}/datasets`)
        .set('Cookie', owner.sessionCookie)
        .attach('file', Buffer.from(uniqueContent), 'first-upload.log');

      expect(firstRes.status).toBe(201);

      // Duplicate upload with identical content: 409 Conflict
      const dupRes = await request(app)
        .post(`/api/v1/workspaces/${owner.workspaceId}/datasets`)
        .set('Cookie', owner.sessionCookie)
        .attach('file', Buffer.from(uniqueContent), 'second-upload.log');

      expect(dupRes.status).toBe(409);
      expect(dupRes.body.errorCode).toBe('DUPLICATE_FILE');
      expect(dupRes.body.message).toContain('identical log file');
    });

    it('allows identical file content in a different workspace (strict workspace isolation)', async () => {
      const ownerA = await makeUser('TenantA');
      const ownerB = await makeUser('TenantB');
      const sharedContent = `Oct 24 10:14:22 server sshd: Accepted publickey for admin from 192.0.2.55 port 22\n`;

      const resA = await request(app)
        .post(`/api/v1/workspaces/${ownerA.workspaceId}/datasets`)
        .set('Cookie', ownerA.sessionCookie)
        .attach('file', Buffer.from(sharedContent), 'auth.log');

      expect(resA.status).toBe(201);

      // Uploading same content in Workspace B is allowed
      const resB = await request(app)
        .post(`/api/v1/workspaces/${ownerB.workspaceId}/datasets`)
        .set('Cookie', ownerB.sessionCookie)
        .attach('file', Buffer.from(sharedContent), 'auth.log');

      expect(resB.status).toBe(201);
    });
  });

  describe('End-to-End Background Worker & Parser Integration', () => {
    it('processes synthetic Linux authentication fixture and persists canonical security events', async () => {
      const owner = await makeUser('WorkerTest');
      const fixturePath = path.resolve(process.cwd(), '../../fixtures/linux-auth/ssh-success.log');
      const fixtureBuffer = fs.readFileSync(
        fs.existsSync(fixturePath) ? fixturePath : path.resolve(process.cwd(), 'fixtures/linux-auth/ssh-success.log')
      );

      const uploadRes = await request(app)
        .post(`/api/v1/workspaces/${owner.workspaceId}/datasets`)
        .set('Cookie', owner.sessionCookie)
        .attach('file', fixtureBuffer, 'ssh-success.log');

      expect(uploadRes.status).toBe(201);
      const datasetId = uploadRes.body.dataset.id;

      // Poll until background worker completes processing (timeout after 10 seconds)
      let completed = false;
      const startTime = Date.now();

      while (Date.now() - startTime < 10000) {
        datasetWorker.triggerImmediate();
        await new Promise((resolve) => setTimeout(resolve, 300));

        const checkRes = await request(app)
          .get(`/api/v1/workspaces/${owner.workspaceId}/datasets/${datasetId}`)
          .set('Cookie', owner.sessionCookie);

        if (checkRes.body.dataset?.status === 'completed') {
          completed = true;
          expect(checkRes.body.dataset.validLines).toBeGreaterThanOrEqual(1);
          expect(checkRes.body.dataset.totalLines).toBeGreaterThanOrEqual(1);
          break;
        }
      }

      expect(completed).toBe(true);

      // Verify events persisted in security_events table with correct tenant_id and dataset_id
      const eventsRes = await request(app)
        .get(`/api/v1/workspaces/${owner.workspaceId}/events`)
        .set('Cookie', owner.sessionCookie);

      expect(eventsRes.status).toBe(200);
      expect(eventsRes.body.total).toBeGreaterThanOrEqual(1);
      const sampleEvent = eventsRes.body.events[0];
      expect(sampleEvent.tenant_id).toBe(owner.workspaceId);
    });
  });

  describe('Role-Based Access Control (RBAC) & Tenant Isolation', () => {
    it('restricts viewer from uploading datasets or retrying failed jobs', async () => {
      const owner = await makeUser('OwnerRBAC');
      const viewerUser = await makeUser('ViewerUser');

      // Add viewerUser to owner's workspace with 'viewer' role
      await addMemberWithRole(owner.sessionCookie, owner.workspaceId, viewerUser.email, 'viewer');

      // 1. Viewer upload is rejected with 403 Forbidden
      const uploadRes = await request(app)
        .post(`/api/v1/workspaces/${owner.workspaceId}/datasets`)
        .set('Cookie', viewerUser.sessionCookie)
        .attach('file', Buffer.from('Oct 24 10:14:22 host sshd: log entry'), 'test.log');

      expect(uploadRes.status).toBe(403);
      expect(uploadRes.body.error).toBe('Forbidden');

      // 2. Viewer listing datasets is permitted (read-only)
      const listRes = await request(app)
        .get(`/api/v1/workspaces/${owner.workspaceId}/datasets`)
        .set('Cookie', viewerUser.sessionCookie);

      expect(listRes.status).toBe(200);

      // 3. Viewer retrying is rejected with 403 Forbidden
      const retryRes = await request(app)
        .post(`/api/v1/workspaces/${owner.workspaceId}/datasets/11111111-1111-1111-1111-111111111111/retry`)
        .set('Cookie', viewerUser.sessionCookie);

      expect(retryRes.status).toBe(403);
    });

    it('permits analyst to upload datasets but forbids retrying jobs', async () => {
      const owner = await makeUser('OwnerAnalyst');
      const analystUser = await makeUser('AnalystUser');

      await addMemberWithRole(owner.sessionCookie, owner.workspaceId, analystUser.email, 'analyst');

      // 1. Analyst upload is permitted
      const uploadRes = await request(app)
        .post(`/api/v1/workspaces/${owner.workspaceId}/datasets`)
        .set('Cookie', analystUser.sessionCookie)
        .attach('file', Buffer.from(`Oct 24 10:14:22 host sshd: Accepted password for analyst from 192.0.2.1\n`), 'analyst.log');

      expect(uploadRes.status).toBe(201);
      const datasetId = uploadRes.body.dataset.id;

      // 2. Analyst retrying is rejected with 403 Forbidden (requires admin+)
      const retryRes = await request(app)
        .post(`/api/v1/workspaces/${owner.workspaceId}/datasets/${datasetId}/retry`)
        .set('Cookie', analystUser.sessionCookie);

      expect(retryRes.status).toBe(403);
    });

    it('prevents cross-workspace IDOR data access and leakages', async () => {
      const ownerA = await makeUser('TenantIsoA');
      const ownerB = await makeUser('TenantIsoB');

      // Upload dataset into Workspace A
      const uploadA = await request(app)
        .post(`/api/v1/workspaces/${ownerA.workspaceId}/datasets`)
        .set('Cookie', ownerA.sessionCookie)
        .attach('file', Buffer.from('Oct 24 bastion sshd: Accepted publickey\n'), 'private-a.log');

      const datasetIdA = uploadA.body.dataset.id;

      // Owner B attempts to view Dataset A: returns 404 (not leaking existence)
      const getRes = await request(app)
        .get(`/api/v1/workspaces/${ownerB.workspaceId}/datasets/${datasetIdA}`)
        .set('Cookie', ownerB.sessionCookie);

      expect(getRes.status).toBe(404);

      // Owner B attempts to download raw log of Dataset A: returns 404
      const downloadRes = await request(app)
        .get(`/api/v1/workspaces/${ownerB.workspaceId}/datasets/${datasetIdA}/raw`)
        .set('Cookie', ownerB.sessionCookie);

      expect(downloadRes.status).toBe(404);

      // Owner B attempts to retry Dataset A in Workspace B route: returns 404
      const retryRes = await request(app)
        .post(`/api/v1/workspaces/${ownerB.workspaceId}/datasets/${datasetIdA}/retry`)
        .set('Cookie', ownerB.sessionCookie);

      expect(retryRes.status).toBe(404);
    });
  });

  describe('Idempotent Retries & Error Handling', () => {
    it('rejects retrying a dataset that is not in failed status', async () => {
      const owner = await makeUser('RetryCompleted');

      const uploadRes = await request(app)
        .post(`/api/v1/workspaces/${owner.workspaceId}/datasets`)
        .set('Cookie', owner.sessionCookie)
        .attach('file', Buffer.from('Oct 24 bastion sshd: Accepted password\n'), 'ok.log');

      const datasetId = uploadRes.body.dataset.id;

      // Immediately attempt retry while queued/processing: must be rejected
      const retryRes = await request(app)
        .post(`/api/v1/workspaces/${owner.workspaceId}/datasets/${datasetId}/retry`)
        .set('Cookie', owner.sessionCookie);

      expect(retryRes.status).toBe(400);
      expect(retryRes.body.message).toContain('Only failed datasets can be retried');
    });

    it('rejects retrying datasets with permanent validation errors', async () => {
      const owner = await makeUser('PermanentFail');

      // Insert mock failed dataset with permanent error code
      const dsRes = await pool.query(
        `INSERT INTO datasets (workspace_id, created_by, original_filename, storage_key, file_size_bytes, file_sha256, status, error_code, error_message)
         VALUES ($1, $2, 'bad.log', $3, 100, $4, 'failed', 'INVALID_ENCODING_OR_BINARY', 'Binary null byte detected')
         RETURNING id`,
        [owner.workspaceId, owner.userId, crypto.randomUUID(), crypto.randomBytes(32).toString('hex')]
      );

      const datasetId = dsRes.rows[0].id;

      const retryRes = await request(app)
        .post(`/api/v1/workspaces/${owner.workspaceId}/datasets/${datasetId}/retry`)
        .set('Cookie', owner.sessionCookie);

      expect(retryRes.status).toBe(400);
      expect(retryRes.body.message).toContain('permanent validation failure');
    });

    it('successfully retries a transiently failed dataset and resets events', async () => {
      const owner = await makeUser('TransientFail');
      const storageKey = crypto.randomUUID();
      const content = 'Oct 24 10:14:22 bastion-01 sshd[14201]: Accepted publickey for deploy from 192.0.2.10 port 49152 ssh2: RSA SHA256:abc\n';

      // Store file in private storage
      await storageService.saveFile(owner.workspaceId, storageKey, Buffer.from(content));

      // Insert mock dataset in failed status with transient error code
      const dsRes = await pool.query(
        `INSERT INTO datasets (workspace_id, created_by, original_filename, storage_key, file_size_bytes, file_sha256, status, error_code, error_message)
         VALUES ($1, $2, 'transient.log', $3, $4, $5, 'failed', 'PARSER_ERROR', 'Temporary worker timeout')
         RETURNING id`,
        [owner.workspaceId, owner.userId, storageKey, content.length, crypto.createHash('sha256').update(content).digest('hex')]
      );

      const datasetId = dsRes.rows[0].id;

      // Call retry endpoint
      const retryRes = await request(app)
        .post(`/api/v1/workspaces/${owner.workspaceId}/datasets/${datasetId}/retry`)
        .set('Cookie', owner.sessionCookie);

      expect(retryRes.status).toBe(200);
      expect(retryRes.body.status).toBe('ok');

      // Verify dataset reset to queued with incremented retry count
      const checkRes = await pool.query('SELECT status, retry_count, error_code FROM datasets WHERE id = $1', [datasetId]);
      expect(checkRes.rows[0].status).toBe('queued');
      expect(checkRes.rows[0].retry_count).toBe(1);
      expect(checkRes.rows[0].error_code).toBeNull();
    });
  });
});
