import { describe, it, expect } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { createApp } from '../src/app.js';
import { inMemorySentEmails } from '../src/services/email.js';
import { pool } from '../src/database/pool.js';
import { config } from '../src/config/env.js';

describe('Authentication & Session Security', () => {
  const app = createApp();

  const testEmail = `sec_user_${crypto.randomBytes(4).toString('hex')}@example.com`;
  const strongPassword = 'StrongPassword123!';
  let userSessionCookie: string;
  let userId: string;

  it('registers a new user and automatically creates an initial owner workspace', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: testEmail,
        password: strongPassword,
        fullName: 'Security Analyst 01',
        workspaceName: 'Alpha Security Operations',
      });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('created');
    expect(res.body.user).toBeDefined();
    expect(res.body.user.email).toBe(testEmail.toLowerCase());
    expect(res.body.user.isVerified).toBe(false);
    expect(res.body.user.password).toBeUndefined();
    expect(res.body.user.password_hash).toBeUndefined();

    // Verify owner workspace creation
    expect(res.body.workspace).toBeDefined();
    expect(res.body.workspace.name).toBe('Alpha Security Operations');
    expect(res.body.workspace.role).toBe('owner');

    userId = res.body.user.id;

    // Check session cookie set
    const cookies = res.headers['set-cookie'] as unknown as string[];
    expect(cookies).toBeDefined();
    const sessionCookie = cookies.find((c: string) => c.startsWith(`${config.auth.sessionCookieName}=`));
    expect(sessionCookie).toBeDefined();
    expect(sessionCookie).toContain('HttpOnly');
    expect(sessionCookie).toContain('SameSite=Lax');
    userSessionCookie = sessionCookie!.split(';')[0];

    // Verify verification email dispatched to dev adapter
    const sentEmail = inMemorySentEmails.find((e) => e.to === testEmail.toLowerCase() && e.type === 'verification');
    expect(sentEmail).toBeDefined();
    expect(sentEmail!.token).toBeDefined();

    // Verify that NO plaintext passwords exist in database
    const dbUser = await pool.query('SELECT password_hash FROM users WHERE id = $1', [userId]);
    expect(dbUser.rows[0].password_hash).not.toBe(strongPassword);
    expect(dbUser.rows[0].password_hash).toMatch(/^\$2[aby]\$\d+\$/);
  });

  it('rejects duplicate email registration with 409 Conflict', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: testEmail.toUpperCase(), // Case-insensitive collision check
        password: strongPassword,
        workspaceName: 'Duplicate Workspace',
      });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Conflict');
  });

  it('rejects weak passwords failing security criteria', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: 'weak_pass_user@example.com',
        password: 'weak',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation Error');
  });

  it('rejects invalid email formats', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: 'not-an-email',
        password: strongPassword,
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation Error');
  });

  it('authenticates user and returns session via /login', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: testEmail,
        password: strongPassword,
      });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.user.email).toBe(testEmail.toLowerCase());

    const cookies = res.headers['set-cookie'] as unknown as string[];
    expect(cookies).toBeDefined();
    const sessionCookie = cookies.find((c: string) => c.startsWith(`${config.auth.sessionCookieName}=`));
    expect(sessionCookie).toBeDefined();
  });

  it('rejects incorrect password with generic 401', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: testEmail,
        password: 'WrongPassword123!',
      });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Unauthorized');
    expect(res.body.message).toContain('Invalid email or password');
  });

  it('rejects nonexistent email with identical 401 preventing account enumeration', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: 'nonexistent_account_404@example.com',
        password: strongPassword,
      });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Unauthorized');
    expect(res.body.message).toContain('Invalid email or password');
  });

  it('retrieves authenticated profile via GET /auth/me with session cookie', async () => {
    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Cookie', userSessionCookie);

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(testEmail.toLowerCase());
    expect(res.body.workspaces).toBeDefined();
    expect(res.body.workspaces.length).toBeGreaterThanOrEqual(1);
  });

  it('rejects unauthenticated requests to protected endpoints', async () => {
    const res = await request(app).get('/api/v1/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Unauthorized');
  });

  it('verifies email with valid single-use token', async () => {
    const sentEmail = inMemorySentEmails.find((e) => e.to === testEmail.toLowerCase() && e.type === 'verification');
    expect(sentEmail).toBeDefined();
    const rawToken = sentEmail!.token;

    const res = await request(app)
      .post('/api/v1/auth/verify-email')
      .send({ token: rawToken });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Email verified successfully.');

    // Verify status updated in database
    const dbCheck = await pool.query('SELECT is_verified FROM users WHERE id = $1', [userId]);
    expect(dbCheck.rows[0].is_verified).toBe(true);

    // Replay attack rejection: token cannot be reused
    const replayRes = await request(app)
      .post('/api/v1/auth/verify-email')
      .send({ token: rawToken });

    expect(replayRes.status).toBe(400);
    expect(replayRes.body.message).toContain('already been used');
  });

  it('handles forgot-password and reset-password securely, invalidating old sessions', async () => {
    // 1. Request reset
    const forgotRes = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: testEmail });

    expect(forgotRes.status).toBe(200);

    const resetEmail = inMemorySentEmails.find((e) => e.to === testEmail.toLowerCase() && e.type === 'password_reset');
    expect(resetEmail).toBeDefined();
    const resetToken = resetEmail!.token;

    // 2. Complete reset with new password
    const newPassword = 'NewSecretPassword2026!';
    const resetRes = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({
        token: resetToken,
        newPassword,
      });

    expect(resetRes.status).toBe(200);

    // 3. Confirm old session cookie is now invalidated
    const meRes = await request(app)
      .get('/api/v1/auth/me')
      .set('Cookie', userSessionCookie);

    expect(meRes.status).toBe(401);

    // 4. Confirm login works with new password
    const newLoginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: testEmail,
        password: newPassword,
      });

    expect(newLoginRes.status).toBe(200);

    // 5. Confirm old password is rejected
    const oldLoginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: testEmail,
        password: strongPassword,
      });

    expect(oldLoginRes.status).toBe(401);
  });

  it('revokes session on logout', async () => {
    // Sign in to obtain fresh session
    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: testEmail,
        password: 'NewSecretPassword2026!',
      });

    const cookieHeader = loginRes.headers['set-cookie'] as unknown as string[];
    const sessionCookie = cookieHeader.find((c: string) => c.startsWith(`${config.auth.sessionCookieName}=`))!.split(';')[0];

    // Logout
    const logoutRes = await request(app)
      .post('/api/v1/auth/logout')
      .set('Cookie', sessionCookie);

    expect(logoutRes.status).toBe(200);

    // Verify session revoked
    const testMeRes = await request(app)
      .get('/api/v1/auth/me')
      .set('Cookie', sessionCookie);

    expect(testMeRes.status).toBe(401);
  });
});

