import { describe, it, expect } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/pool.js';
import { config } from '../src/config/env.js';
import { inMemorySentEmails } from '../src/services/email.js';

// Mirror frontend helper logic to test the contract directly
function shouldDisplayVerificationWarning(user: { isVerified?: boolean; is_verified?: boolean } | null | undefined): boolean {
  if (!user) return false;
  const verified = Boolean(user.isVerified ?? user.is_verified);
  return !verified;
}

describe('Email Verification Status & Authority Regression Suite', () => {
  const app = createApp();
  const uniqueSuffix = crypto.randomBytes(4).toString('hex');
  const testEmail = `verif_test_${uniqueSuffix}@example.com`;
  const strongPassword = 'StrongPassword2026!#$';
  let sessionCookie: string;
  let userId: string;
  let workspaceId: string;

  it('verifies that users.is_verified is the single authoritative database column', async () => {
    const colRes = await pool.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'users' AND column_name IN ('is_verified', 'email_verified', 'email_verified_at')
    `);

    const colNames = colRes.rows.map(r => r.column_name);
    expect(colNames).toContain('is_verified');
    expect(colNames).not.toContain('email_verified');
    expect(colNames).not.toContain('email_verified_at');
  });

  it('ensures registration returns consistent boolean verification properties', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: testEmail,
        password: strongPassword,
        fullName: 'Verification Test User',
        workspaceName: `Test WS ${uniqueSuffix}`,
      });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('created');
    userId = res.body.user.id;
    workspaceId = res.body.workspace.id;

    // Both isVerified and is_verified must be boolean false
    expect(res.body.user.isVerified).toBe(false);
    expect(res.body.user.is_verified).toBe(false);

    // Extract session cookie
    const cookies = res.headers['set-cookie'] as unknown as string[];
    const sessionCookieHeader = cookies.find((c: string) => c.startsWith(`${config.auth.sessionCookieName}=`));
    expect(sessionCookieHeader).toBeDefined();
    sessionCookie = sessionCookieHeader!.split(';')[0];
  });

  it('ensures GET /api/v1/auth/me returns boolean verification property and displays warning for unverified user', async () => {
    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Cookie', sessionCookie);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');

    // Both properties must accurately reflect the unverified database state
    expect(res.body.user.isVerified).toBe(false);
    expect(res.body.user.is_verified).toBe(false);

    // Frontend warning condition: unverified account MUST display the warning
    const displaysWarning = shouldDisplayVerificationWarning(res.body.user);
    expect(displaysWarning).toBe(true);
  });

  it('restricts unverified accounts from performing administrative actions requiring verification', async () => {
    // 1. Creating a new workspace is forbidden for unverified users
    const wsRes = await request(app)
      .post('/api/v1/workspaces')
      .set('Cookie', sessionCookie)
      .send({ name: 'Unverified Attempt Workspace' });

    expect(wsRes.status).toBe(403);
    expect(wsRes.body.error).toBe('Forbidden');
    expect(wsRes.body.verificationRequired).toBe(true);
    expect(wsRes.body.message).toContain('Email verification is required');

    // 2. Modifying members is forbidden for unverified users
    const memberRes = await request(app)
      .post(`/api/v1/workspaces/${workspaceId}/members`)
      .set('Cookie', sessionCookie)
      .send({ email: 'newmember@example.com', role: 'analyst' });

    expect(memberRes.status).toBe(403);
    expect(memberRes.body.verificationRequired).toBe(true);
  });

  it('successfully verifies email, updates authoritative DB state, and reflects immediately in GET /me', async () => {
    // Locate the single-use verification email generated during registration
    const sentEmail = inMemorySentEmails.find(
      (e) => e.to === testEmail.toLowerCase() && e.type === 'verification'
    );
    expect(sentEmail).toBeDefined();
    const rawToken = sentEmail!.token;

    // Call verification endpoint
    const verifyRes = await request(app)
      .post('/api/v1/auth/verify-email')
      .send({ token: rawToken });

    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.status).toBe('ok');
    expect(verifyRes.body.message).toBe('Email verified successfully.');

    // Confirm database row is updated
    const dbRes = await pool.query('SELECT is_verified FROM users WHERE id = $1', [userId]);
    expect(dbRes.rows[0].is_verified).toBe(true);

    // Call GET /me with the existing session - session deserialization must reflect the fresh DB state
    const meRes = await request(app)
      .get('/api/v1/auth/me')
      .set('Cookie', sessionCookie);

    expect(meRes.status).toBe(200);
    expect(meRes.body.user.isVerified).toBe(true);
    expect(meRes.body.user.is_verified).toBe(true);

    // Frontend warning condition: verified account must NOT display warning
    const displaysWarning = shouldDisplayVerificationWarning(meRes.body.user);
    expect(displaysWarning).toBe(false);
  });

  it('permits verified accounts to perform actions allowed by their role', async () => {
    const wsRes = await request(app)
      .post('/api/v1/workspaces')
      .set('Cookie', sessionCookie)
      .send({ name: `Verified Allowed WS ${uniqueSuffix}` });

    expect(wsRes.status).toBe(201);
    expect(wsRes.body.status).toBe('created');
    expect(wsRes.body.workspace.name).toBe(`Verified Allowed WS ${uniqueSuffix}`);
  });

  it('handles resend verification for already-verified account without reverting UI state', async () => {
    // Attempting to resend verification when already verified
    const resendRes = await request(app)
      .post('/api/v1/auth/resend-verification')
      .set('Cookie', sessionCookie);

    expect(resendRes.status).toBe(400);
    expect(resendRes.body.error).toBe('Bad Request');
    expect(resendRes.body.message).toContain('already verified');
    expect(resendRes.body.alreadyVerified).toBe(true);
    expect(resendRes.body.isVerified).toBe(true);

    // Re-verify that user remains verified in GET /me
    const meRes = await request(app)
      .get('/api/v1/auth/me')
      .set('Cookie', sessionCookie);

    expect(meRes.status).toBe(200);
    expect(meRes.body.user.isVerified).toBe(true);
    expect(meRes.body.user.is_verified).toBe(true);

    // UI state remains verified: warning is NOT displayed
    const displaysWarning = shouldDisplayVerificationWarning(meRes.body.user);
    expect(displaysWarning).toBe(false);
  });

  it('validates frontend warning helper logic across all possible input shapes', () => {
    expect(shouldDisplayVerificationWarning(null)).toBe(false);
    expect(shouldDisplayVerificationWarning(undefined)).toBe(false);

    // Unverified shapes -> show warning
    expect(shouldDisplayVerificationWarning({ isVerified: false, is_verified: false })).toBe(true);
    expect(shouldDisplayVerificationWarning({ isVerified: false })).toBe(true);
    expect(shouldDisplayVerificationWarning({ is_verified: false })).toBe(true);

    // Verified shapes -> hide warning
    expect(shouldDisplayVerificationWarning({ isVerified: true, is_verified: true })).toBe(false);
    expect(shouldDisplayVerificationWarning({ isVerified: true })).toBe(false);
    expect(shouldDisplayVerificationWarning({ is_verified: true })).toBe(false);
  });
});
