import { Request } from 'express';
import pg from 'pg';
import { pool } from '../database/pool.js';
import { generateSecureToken, hashToken } from './tokens.js';
import { config } from '../config/env.js';

export interface AuthUser {
  id: string;
  email: string;
  full_name: string | null;
  fullName: string | null;
  is_verified: boolean;
  isVerified: boolean;
  is_active: boolean;
  isActive: boolean;
  created_at: string;
  createdAt: string;
}

export interface AuthSession {
  id: string;
  user_id: string;
  expires_at: string;
  created_at: string;
  last_active_at: string;
}

export async function createSession(
  userId: string,
  req?: Request,
  dbExecutor: pg.Pool | pg.PoolClient = pool
): Promise<{ sessionToken: string; expiresAt: Date }> {
  const { rawToken, tokenHash } = generateSecureToken();
  const expiresAt = new Date(Date.now() + config.auth.sessionExpirationDays * 24 * 60 * 60 * 1000);

  const userAgent = req?.headers['user-agent']?.slice(0, 512) || null;
  const ipAddress = (req?.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req?.socket?.remoteAddress || null;

  const query = `
    INSERT INTO sessions (
      session_token_hash, user_id, expires_at, user_agent, ip_address
    ) VALUES ($1, $2, $3, $4, $5)
    RETURNING id;
  `;

  await dbExecutor.query(query, [tokenHash, userId, expiresAt.toISOString(), userAgent, ipAddress]);

  return { sessionToken: rawToken, expiresAt };
}

export async function validateSession(
  sessionToken: string
): Promise<{ user: AuthUser; session: AuthSession } | null> {
  if (!sessionToken || typeof sessionToken !== 'string') {
    return null;
  }

  const tokenHash = hashToken(sessionToken);

  const query = `
    SELECT 
      u.id AS user_id,
      u.email,
      u.full_name,
      u.is_verified,
      u.is_active,
      u.created_at AS user_created_at,
      s.id AS session_id,
      s.expires_at,
      s.created_at AS session_created_at,
      s.last_active_at
    FROM sessions s
    JOIN users u ON s.user_id = u.id
    WHERE s.session_token_hash = $1
      AND s.expires_at > NOW()
      AND u.is_active = TRUE;
  `;

  const result = await pool.query(query, [tokenHash]);
  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];

  // Asynchronously update last_active_at without blocking request
  pool.query('UPDATE sessions SET last_active_at = NOW() WHERE id = $1', [row.session_id]).catch(() => {});

  const userCreatedAt = typeof row.user_created_at === 'object' && row.user_created_at instanceof Date
    ? row.user_created_at.toISOString()
    : String(row.user_created_at);

  return {
    user: {
      id: row.user_id,
      email: row.email,
      full_name: row.full_name,
      fullName: row.full_name,
      is_verified: Boolean(row.is_verified),
      isVerified: Boolean(row.is_verified),
      is_active: Boolean(row.is_active),
      isActive: Boolean(row.is_active),
      created_at: userCreatedAt,
      createdAt: userCreatedAt,
    },
    session: {
      id: row.session_id,
      user_id: row.user_id,
      expires_at: row.expires_at,
      created_at: row.session_created_at,
      last_active_at: row.last_active_at,
    },
  };
}

export async function revokeSession(sessionToken: string): Promise<void> {
  if (!sessionToken || typeof sessionToken !== 'string') {
    return;
  }
  const tokenHash = hashToken(sessionToken);
  await pool.query('DELETE FROM sessions WHERE session_token_hash = $1', [tokenHash]);
}

export async function revokeAllUserSessions(userId: string): Promise<void> {
  await pool.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
}
