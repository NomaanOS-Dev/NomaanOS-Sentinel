import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { pool } from '../database/pool.js';
import { hashPassword, verifyPassword, validatePasswordStrength } from '../services/password.js';
import { createSession, revokeSession, revokeAllUserSessions } from '../services/session.js';
import { generateSecureToken, hashToken } from '../services/tokens.js';
import { emailService } from '../services/email.js';
import { setSessionCookie, clearSessionCookie } from '../services/cookie.js';
import { authenticate } from '../middleware/auth.js';
import { authRateLimiter, passwordResetRateLimiter } from '../middleware/rate-limiter.js';
import { logger } from '../config/logger.js';
import { config } from '../config/env.js';

export const authRouter = Router();

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function serializeUser(user: {
  id: string;
  email: string;
  full_name?: string | null;
  fullName?: string | null;
  is_verified?: boolean;
  isVerified?: boolean;
  is_active?: boolean;
  isActive?: boolean;
  created_at?: string | Date;
  createdAt?: string | Date;
}) {
  const isVerified = Boolean(user.isVerified ?? user.is_verified);
  const isActive = Boolean(user.isActive ?? user.is_active ?? true);
  const fullName = user.fullName !== undefined ? user.fullName : (user.full_name !== undefined ? user.full_name : null);
  const rawCreatedAt = user.createdAt ?? user.created_at ?? new Date().toISOString();
  const createdAt = typeof rawCreatedAt === 'object' && rawCreatedAt instanceof Date 
    ? rawCreatedAt.toISOString() 
    : String(rawCreatedAt);

  return {
    id: user.id,
    email: user.email,
    fullName,
    full_name: fullName,
    isVerified,
    is_verified: isVerified,
    isActive,
    is_active: isActive,
    createdAt,
    created_at: createdAt,
  };
}

// 1. Register
authRouter.post('/register', authRateLimiter, async (req: Request, res: Response, next: NextFunction) => {
  const client = await pool.connect();
  try {
    const { email, password, fullName, workspaceName } = req.body;

    if (!email || typeof email !== 'string' || !EMAIL_REGEX.test(email)) {
      res.status(400).json({ error: 'Validation Error', message: 'A valid email address is required.' });
      return;
    }

    const passwordValidation = validatePasswordStrength(password);
    if (!passwordValidation.valid) {
      res.status(400).json({ error: 'Validation Error', message: passwordValidation.error });
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Check if user already exists
    const existing = await client.query('SELECT id FROM users WHERE LOWER(email) = $1', [normalizedEmail]);
    if (existing.rows.length > 0) {
      res.status(409).json({
        error: 'Conflict',
        message: 'An account with this email address already exists.',
      });
      return;
    }

    const passwordHash = await hashPassword(password);
    const initialWorkspaceName = (typeof workspaceName === 'string' && workspaceName.trim()) 
      ? workspaceName.trim() 
      : 'Primary Workspace';

    const slug = `${initialWorkspaceName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${crypto.randomBytes(3).toString('hex')}`;

    await client.query('BEGIN');

    // Create user
    const userRes = await client.query(
      `INSERT INTO users (email, password_hash, full_name, is_verified)
       VALUES ($1, $2, $3, FALSE)
       RETURNING id, email, full_name, is_verified, is_active, created_at;`,
      [normalizedEmail, passwordHash, fullName?.trim() || null]
    );
    const user = userRes.rows[0];

    // Create initial workspace
    const wsRes = await client.query(
      `INSERT INTO workspaces (name, slug, created_by)
       VALUES ($1, $2, $3)
       RETURNING id, name, slug;`,
      [initialWorkspaceName, slug, user.id]
    );
    const workspace = wsRes.rows[0];

    // Add user as workspace OWNER
    await client.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role)
       VALUES ($1, $2, 'owner');`,
      [workspace.id, user.id]
    );

    // Generate single-use email verification token (expires in 24 hours)
    const { rawToken, tokenHash } = generateSecureToken();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await client.query(
      `INSERT INTO email_verification_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3);`,
      [user.id, tokenHash, expiresAt.toISOString()]
    );

    // Create active session within the transaction
    const { sessionToken, expiresAt: sessionExpiresAt } = await createSession(user.id, req, client);

    await client.query('COMMIT');

    // Send verification email via provider abstraction
    await emailService.sendVerificationEmail(user.email, rawToken);

    // Set HttpOnly SameSite session cookie
    setSessionCookie(res, sessionToken, sessionExpiresAt);

    logger.info({ userId: user.id, email: user.email }, 'User registered successfully');

    res.status(201).json({
      status: 'created',
      user: serializeUser(user),
      workspace: {
        id: workspace.id,
        name: workspace.name,
        slug: workspace.slug,
        role: 'owner',
      },
    });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

// 2. Sign In
authRouter.post('/login', authRateLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password } = req.body;

    if (!email || !password || typeof email !== 'string' || typeof password !== 'string') {
      res.status(400).json({ error: 'Validation Error', message: 'Email and password are required.' });
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();

    const userRes = await pool.query(
      `SELECT id, email, password_hash, full_name, is_verified, is_active, created_at
       FROM users WHERE LOWER(email) = $1`,
      [normalizedEmail]
    );

    if (userRes.rows.length === 0) {
      // Constant-time dummy verify to prevent timing enumeration
      await verifyPassword(password, '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy');
      res.status(401).json({ error: 'Unauthorized', message: 'Invalid email or password.' });
      return;
    }

    const user = userRes.rows[0];

    const passwordMatches = await verifyPassword(password, user.password_hash);
    if (!passwordMatches) {
      res.status(401).json({ error: 'Unauthorized', message: 'Invalid email or password.' });
      return;
    }

    if (!user.is_active) {
      res.status(403).json({ error: 'Forbidden', message: 'This account has been deactivated.' });
      return;
    }

    // Create session
    const { sessionToken, expiresAt } = await createSession(user.id, req);

    setSessionCookie(res, sessionToken, expiresAt);

    logger.info({ userId: user.id }, 'User signed in successfully');

    res.status(200).json({
      status: 'ok',
      user: serializeUser(user),
    });
  } catch (err) {
    next(err);
  }
});

// 3. Current Authenticated User & Workspaces
authRouter.get('/me', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const workspacesRes = await pool.query(
      `SELECT * FROM (
        SELECT DISTINCT ON (w.id)
          w.id,
          w.name,
          w.slug,
          w.organization_id,
          o.name AS organization_name,
          COALESCE(wm.role, om.role) AS role,
          COALESCE(wm.created_at, om.created_at) AS joined_at
        FROM workspaces w
        LEFT JOIN workspace_memberships wm ON w.id = wm.workspace_id AND wm.user_id = $1
        LEFT JOIN organizations o ON w.organization_id = o.id
        LEFT JOIN organization_memberships om ON w.organization_id = om.organization_id AND om.user_id = $1
        WHERE wm.user_id = $1 OR om.user_id = $1
        ORDER BY w.id, w.created_at ASC
      ) sub
      ORDER BY sub.joined_at ASC`,
      [req.user!.id]
    );

    const orgsRes = await pool.query(
      `SELECT 
        o.id,
        o.name,
        o.slug,
        om.role,
        om.created_at AS joined_at,
        (SELECT COUNT(*) FROM workspaces WHERE organization_id = o.id)::int AS client_count
       FROM organization_memberships om
       JOIN organizations o ON om.organization_id = o.id
       WHERE om.user_id = $1
       ORDER BY om.created_at ASC`,
      [req.user!.id]
    );

    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.status(200).json({
      status: 'ok',
      user: serializeUser(req.user!),
      workspaces: workspacesRes.rows,
      organizations: orgsRes.rows,
    });
  } catch (err) {
    next(err);
  }
});

// 4. Logout
authRouter.post('/logout', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sessionToken = req.cookies?.[config.auth.sessionCookieName] || 
      (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7).trim() : null);

    if (sessionToken) {
      await revokeSession(sessionToken);
    }

    clearSessionCookie(res);

    res.status(200).json({ status: 'ok', message: 'Signed out successfully.' });
  } catch (err) {
    next(err);
  }
});

// 5. Verify Email
authRouter.post('/verify-email', async (req: Request, res: Response, next: NextFunction) => {
  const client = await pool.connect();
  try {
    const { token } = req.body;
    if (!token || typeof token !== 'string') {
      res.status(400).json({ error: 'Validation Error', message: 'Verification token is required.' });
      return;
    }

    const tokenHash = hashToken(token.trim());

    await client.query('BEGIN');

    const tokenRes = await client.query(
      `SELECT id, user_id, expires_at, used_at 
       FROM email_verification_tokens 
       WHERE token_hash = $1 FOR UPDATE`,
      [tokenHash]
    );

    if (tokenRes.rows.length === 0) {
      await client.query('ROLLBACK');
      res.status(400).json({ error: 'Bad Request', message: 'Invalid verification token.' });
      return;
    }

    const tokenRecord = tokenRes.rows[0];

    if (tokenRecord.used_at) {
      await client.query('ROLLBACK');
      res.status(400).json({ error: 'Bad Request', message: 'This verification token has already been used.' });
      return;
    }

    if (new Date(tokenRecord.expires_at).getTime() < Date.now()) {
      await client.query('ROLLBACK');
      res.status(400).json({ error: 'Bad Request', message: 'Verification token has expired. Please request a new one.' });
      return;
    }

    // Mark token used and update user status
    await client.query('UPDATE email_verification_tokens SET used_at = NOW() WHERE id = $1', [tokenRecord.id]);
    await client.query('UPDATE users SET is_verified = TRUE, updated_at = NOW() WHERE id = $1', [tokenRecord.user_id]);

    await client.query('COMMIT');

    logger.info({ userId: tokenRecord.user_id }, 'User email verified successfully');

    res.status(200).json({ status: 'ok', message: 'Email verified successfully.' });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

// 6. Resend Email Verification
authRouter.post('/resend-verification', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (req.user!.is_verified || req.user!.isVerified) {
      res.status(400).json({
        error: 'Bad Request',
        message: 'Email address is already verified.',
        alreadyVerified: true,
        isVerified: true,
        is_verified: true,
      });
      return;
    }

    const { rawToken, tokenHash } = generateSecureToken();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await pool.query(
      `INSERT INTO email_verification_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3)`,
      [req.user!.id, tokenHash, expiresAt.toISOString()]
    );

    await emailService.sendVerificationEmail(req.user!.email, rawToken);

    res.status(200).json({ status: 'ok', message: 'Verification email sent.' });
  } catch (err) {
    next(err);
  }
});

// 7. Request Password Reset (Forgot Password)
authRouter.post('/forgot-password', passwordResetRateLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email } = req.body;
    if (!email || typeof email !== 'string') {
      res.status(400).json({ error: 'Validation Error', message: 'A valid email address is required.' });
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();
    const genericResponse = {
      status: 'ok',
      message: 'If an account exists with this email address, a password reset link has been dispatched.',
    };

    const userRes = await pool.query('SELECT id, email, is_active FROM users WHERE LOWER(email) = $1', [normalizedEmail]);

    if (userRes.rows.length === 0 || !userRes.rows[0].is_active) {
      // Do not disclose whether email exists
      res.status(200).json(genericResponse);
      return;
    }

    const user = userRes.rows[0];
    const { rawToken, tokenHash } = generateSecureToken();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour expiration

    await pool.query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3)`,
      [user.id, tokenHash, expiresAt.toISOString()]
    );

    await emailService.sendPasswordResetEmail(user.email, rawToken);

    res.status(200).json(genericResponse);
  } catch (err) {
    next(err);
  }
});

// 8. Complete Password Reset
authRouter.post('/reset-password', passwordResetRateLimiter, async (req: Request, res: Response, next: NextFunction) => {
  const client = await pool.connect();
  try {
    const { token, newPassword } = req.body;

    if (!token || typeof token !== 'string') {
      res.status(400).json({ error: 'Validation Error', message: 'Reset token is required.' });
      return;
    }

    const passwordValidation = validatePasswordStrength(newPassword);
    if (!passwordValidation.valid) {
      res.status(400).json({ error: 'Validation Error', message: passwordValidation.error });
      return;
    }

    const tokenHash = hashToken(token.trim());

    await client.query('BEGIN');

    const tokenRes = await client.query(
      `SELECT id, user_id, expires_at, used_at
       FROM password_reset_tokens
       WHERE token_hash = $1 FOR UPDATE`,
      [tokenHash]
    );

    if (tokenRes.rows.length === 0) {
      await client.query('ROLLBACK');
      res.status(400).json({ error: 'Bad Request', message: 'Invalid or expired password reset token.' });
      return;
    }

    const tokenRecord = tokenRes.rows[0];

    if (tokenRecord.used_at) {
      await client.query('ROLLBACK');
      res.status(400).json({ error: 'Bad Request', message: 'This password reset token has already been used.' });
      return;
    }

    if (new Date(tokenRecord.expires_at).getTime() < Date.now()) {
      await client.query('ROLLBACK');
      res.status(400).json({ error: 'Bad Request', message: 'Password reset token has expired. Please request a new one.' });
      return;
    }

    const newPasswordHash = await hashPassword(newPassword);

    // Update password and mark token used
    await client.query('UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1', [tokenRecord.id]);
    await client.query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [newPasswordHash, tokenRecord.user_id]);

    // Critical security: Invalidate all existing sessions for this user!
    await client.query('DELETE FROM sessions WHERE user_id = $1', [tokenRecord.user_id]);

    await client.query('COMMIT');

    clearSessionCookie(res);

    logger.info({ userId: tokenRecord.user_id }, 'User password reset successfully, all existing sessions invalidated');

    res.status(200).json({
      status: 'ok',
      message: 'Password reset successfully. Please sign in with your new password.',
    });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});
