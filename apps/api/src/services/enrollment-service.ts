import crypto from 'crypto';
import pg from 'pg';
import { pool } from '../database/pool.js';
import { config } from '../config/env.js';
import { hashToken, timingSafeMatch } from './tokens.js';
import { logger } from '../config/logger.js';

export type IntegrationType = 'linux_auth';
export type IntegrationStatus = 'pending' | 'connected' | 'disconnected' | 'error' | 'revoked';

export interface IntegrationRecord {
  id: string;
  workspaceId: string;
  name: string;
  integrationType: IntegrationType;
  status: IntegrationStatus;
  createdBy: string;
  creatorEmail?: string;
  creatorName?: string | null;
  agentId: string | null;
  lastSeenAt: string | null;
  lastErrorMessage: string | null;
  lastErrorAt: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  hasActiveToken?: boolean;
  activeTokenExpiresAt?: string | null;
}

export interface EnrollmentInitiationResult {
  integrationId: string;
  enrollmentToken: string;
  expiresAt: string;
  expiresInSeconds: number;
  status: IntegrationStatus;
  warning: string;
}

export interface EnrollmentConsumptionResult {
  success: boolean;
  agentId?: string;
  agentKey?: string;
  integrationId?: string;
  workspaceId?: string;
  error?: string;
}

export interface AgentVerificationResult {
  valid: boolean;
  agentId?: string;
  integrationId?: string;
  workspaceId?: string;
  error?: string;
}

export interface IntegrationAuditLogRecord {
  id: string;
  integrationId: string;
  workspaceId: string;
  actorId: string | null;
  actorEmail?: string | null;
  actorName?: string | null;
  action: string;
  details: Record<string, unknown>;
  createdAt: string;
}

/**
 * Record a sanitized audit event for an integration.
 * NEVER stores raw secrets, tokens, or credentials in details.
 */
export async function recordIntegrationAuditLog(
  clientOrPool: pg.Pool | pg.PoolClient,
  params: {
    integrationId: string;
    workspaceId: string;
    actorId: string | null;
    action: string;
    details?: Record<string, unknown>;
  }
): Promise<void> {
  const sanitizedDetails = { ...(params.details || {}) };
  // Defensive secret removal
  delete sanitizedDetails.token;
  delete sanitizedDetails.enrollmentToken;
  delete sanitizedDetails.agentKey;
  delete sanitizedDetails.secret;
  delete sanitizedDetails.password;

  await clientOrPool.query(
    `INSERT INTO integration_audit_logs (
       integration_id, workspace_id, actor_id, action, details
     ) VALUES ($1, $2, $3, $4, $5)`,
    [
      params.integrationId,
      params.workspaceId,
      params.actorId,
      params.action,
      JSON.stringify(sanitizedDetails),
    ]
  );
}

/**
 * Create a new integration within a workspace.
 */
export async function createIntegration(
  workspaceId: string,
  userId: string,
  name: string,
  integrationType: IntegrationType = 'linux_auth',
  metadata: Record<string, unknown> = {}
): Promise<IntegrationRecord> {
  const trimmedName = name.trim();
  if (!trimmedName || trimmedName.length > 255) {
    throw new Error('Integration name is required and must not exceed 255 characters.');
  }

  if (integrationType !== 'linux_auth') {
    throw new Error(`Unsupported integration type: ${integrationType}. Only 'linux_auth' is supported.`);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const res = await client.query(
      `INSERT INTO integrations (
         workspace_id, name, integration_type, status, created_by, metadata
       ) VALUES ($1, $2, $3, 'pending', $4, $5)
       RETURNING id, workspace_id, name, integration_type, status, created_by,
                 agent_id, last_seen_at, last_error_message, last_error_at,
                 metadata, created_at, updated_at`,
      [workspaceId, trimmedName, integrationType, userId, JSON.stringify(metadata)]
    );

    const integration = res.rows[0];

    await recordIntegrationAuditLog(client, {
      integrationId: integration.id,
      workspaceId,
      actorId: userId,
      action: 'integration_created',
      details: {
        name: trimmedName,
        integrationType,
      },
    });

    await client.query('COMMIT');

    return {
      id: integration.id,
      workspaceId: integration.workspace_id,
      name: integration.name,
      integrationType: integration.integration_type,
      status: integration.status,
      createdBy: integration.created_by,
      agentId: integration.agent_id,
      lastSeenAt: integration.last_seen_at,
      lastErrorMessage: integration.last_error_message,
      lastErrorAt: integration.last_error_at,
      metadata: integration.metadata || {},
      createdAt: integration.created_at,
      updatedAt: integration.updated_at,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * List all integrations for a workspace with membership validation.
 */
export async function listIntegrations(workspaceId: string): Promise<IntegrationRecord[]> {
  const query = `
    SELECT 
      i.id,
      i.workspace_id,
      i.name,
      i.integration_type,
      i.status,
      i.created_by,
      u.email AS creator_email,
      u.full_name AS creator_name,
      i.agent_id,
      i.last_seen_at,
      i.last_error_message,
      i.last_error_at,
      i.metadata,
      i.created_at,
      i.updated_at,
      EXISTS (
        SELECT 1 FROM enrollment_tokens et
        WHERE et.integration_id = i.id
          AND et.is_revoked = FALSE
          AND et.used_at IS NULL
          AND et.expires_at > NOW()
      ) AS has_active_token,
      (
        SELECT et.expires_at FROM enrollment_tokens et
        WHERE et.integration_id = i.id
          AND et.is_revoked = FALSE
          AND et.used_at IS NULL
          AND et.expires_at > NOW()
        ORDER BY et.created_at DESC
        LIMIT 1
      ) AS active_token_expires_at
    FROM integrations i
    LEFT JOIN users u ON i.created_by = u.id
    WHERE i.workspace_id = $1
    ORDER BY i.created_at DESC;
  `;

  const res = await pool.query(query, [workspaceId]);

  return res.rows.map((row) => ({
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    integrationType: row.integration_type,
    status: row.status,
    createdBy: row.created_by,
    creatorEmail: row.creator_email,
    creatorName: row.creator_name,
    agentId: row.agent_id,
    lastSeenAt: row.last_seen_at,
    lastErrorMessage: row.last_error_message,
    lastErrorAt: row.last_error_at,
    metadata: row.metadata || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    hasActiveToken: Boolean(row.has_active_token),
    activeTokenExpiresAt: row.active_token_expires_at || null,
  }));
}

/**
 * Retrieve a single integration by ID with associated audit history.
 */
export async function getIntegrationDetail(
  workspaceId: string,
  integrationId: string
): Promise<{ integration: IntegrationRecord; auditLogs: IntegrationAuditLogRecord[] } | null> {
  const integrationQuery = `
    SELECT 
      i.id,
      i.workspace_id,
      i.name,
      i.integration_type,
      i.status,
      i.created_by,
      u.email AS creator_email,
      u.full_name AS creator_name,
      i.agent_id,
      i.last_seen_at,
      i.last_error_message,
      i.last_error_at,
      i.metadata,
      i.created_at,
      i.updated_at,
      EXISTS (
        SELECT 1 FROM enrollment_tokens et
        WHERE et.integration_id = i.id
          AND et.is_revoked = FALSE
          AND et.used_at IS NULL
          AND et.expires_at > NOW()
      ) AS has_active_token,
      (
        SELECT et.expires_at FROM enrollment_tokens et
        WHERE et.integration_id = i.id
          AND et.is_revoked = FALSE
          AND et.used_at IS NULL
          AND et.expires_at > NOW()
        ORDER BY et.created_at DESC
        LIMIT 1
      ) AS active_token_expires_at
    FROM integrations i
    LEFT JOIN users u ON i.created_by = u.id
    WHERE i.id = $1 AND i.workspace_id = $2;
  `;

  const auditQuery = `
    SELECT 
      al.id,
      al.integration_id,
      al.workspace_id,
      al.actor_id,
      u.email AS actor_email,
      u.full_name AS actor_name,
      al.action,
      al.details,
      al.created_at
    FROM integration_audit_logs al
    LEFT JOIN users u ON al.actor_id = u.id
    WHERE al.integration_id = $1 AND al.workspace_id = $2
    ORDER BY al.created_at DESC
    LIMIT 50;
  `;

  const [intRes, auditRes] = await Promise.all([
    pool.query(integrationQuery, [integrationId, workspaceId]),
    pool.query(auditQuery, [integrationId, workspaceId]),
  ]);

  if (intRes.rows.length === 0) {
    return null;
  }

  const row = intRes.rows[0];

  const integration: IntegrationRecord = {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    integrationType: row.integration_type,
    status: row.status,
    createdBy: row.created_by,
    creatorEmail: row.creator_email,
    creatorName: row.creator_name,
    agentId: row.agent_id,
    lastSeenAt: row.last_seen_at,
    lastErrorMessage: row.last_error_message,
    lastErrorAt: row.last_error_at,
    metadata: row.metadata || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    hasActiveToken: Boolean(row.has_active_token),
    activeTokenExpiresAt: row.active_token_expires_at || null,
  };

  const auditLogs: IntegrationAuditLogRecord[] = auditRes.rows.map((a) => ({
    id: a.id,
    integrationId: a.integration_id,
    workspaceId: a.workspace_id,
    actorId: a.actor_id,
    actorEmail: a.actor_email,
    actorName: a.actor_name,
    action: a.action,
    details: a.details || {},
    createdAt: a.created_at,
  }));

  return { integration, auditLogs };
}

/**
 * Generate a cryptographically secure, single-use, expiring enrollment token.
 * Plaintext token is returned ONLY ONCE in the response and never persisted to the DB.
 */
export async function createEnrollmentToken(
  workspaceId: string,
  integrationId: string,
  userId: string
): Promise<EnrollmentInitiationResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Lock and verify integration ownership & status
    const intRes = await client.query(
      `SELECT id, status FROM integrations WHERE id = $1 AND workspace_id = $2 FOR UPDATE`,
      [integrationId, workspaceId]
    );

    if (intRes.rows.length === 0) {
      throw new Error('Integration not found.');
    }

    if (intRes.rows[0].status === 'revoked') {
      throw new Error('Cannot initiate enrollment for a revoked integration.');
    }

    // 2. Invalidate/revoke any previously active, unconsumed tokens for this integration
    await client.query(
      `UPDATE enrollment_tokens 
       SET is_revoked = TRUE, revoked_at = NOW(), revoked_by = $1
       WHERE integration_id = $2 
         AND is_revoked = FALSE 
         AND used_at IS NULL`,
      [userId, integrationId]
    );

    // 3. Generate high-entropy token (256-bit random hex with sentinel prefix)
    const rawEntropy = crypto.randomBytes(32).toString('hex');
    const rawToken = `sentinel_enroll_${rawEntropy}`;
    const tokenHash = hashToken(rawToken);

    // 4. Calculate expiration timestamp
    const expirationMinutes = config.enrollment.tokenExpirationMinutes;
    const expiresAtDate = new Date(Date.now() + expirationMinutes * 60 * 1000);
    const expiresAt = expiresAtDate.toISOString();

    // 5. Store ONLY the SHA-256 hash in database
    await client.query(
      `INSERT INTO enrollment_tokens (
         integration_id, workspace_id, token_hash, created_by, expires_at
       ) VALUES ($1, $2, $3, $4, $5)`,
      [integrationId, workspaceId, tokenHash, userId, expiresAt]
    );

    // 6. Record audit log without sensitive token material
    await recordIntegrationAuditLog(client, {
      integrationId,
      workspaceId,
      actorId: userId,
      action: 'enrollment_initiated',
      details: {
        expiresAt,
        expirationMinutes,
      },
    });

    await client.query('COMMIT');

    logger.info(
      { integrationId, workspaceId, actorId: userId, expiresAt },
      'Generated secure single-use enrollment token'
    );

    return {
      integrationId,
      enrollmentToken: rawToken,
      expiresAt,
      expiresInSeconds: expirationMinutes * 60,
      status: intRes.rows[0].status,
      warning:
        'This enrollment token is sensitive, short-lived, and single-use. Store or copy it immediately; it will never be displayed again.',
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Inspect enrollment state without revealing secret tokens.
 */
export async function inspectEnrollmentState(
  workspaceId: string,
  integrationId: string
): Promise<{
  integrationId: string;
  integrationStatus: IntegrationStatus;
  hasActiveToken: boolean;
  tokenExpiresAt: string | null;
  isEnrolled: boolean;
  agentId: string | null;
  lastSeenAt: string | null;
} | null> {
  const query = `
    SELECT 
      i.id,
      i.status,
      i.agent_id,
      i.last_seen_at,
      EXISTS (
        SELECT 1 FROM enrollment_tokens et
        WHERE et.integration_id = i.id
          AND et.is_revoked = FALSE
          AND et.used_at IS NULL
          AND et.expires_at > NOW()
      ) AS has_active_token,
      (
        SELECT et.expires_at FROM enrollment_tokens et
        WHERE et.integration_id = i.id
          AND et.is_revoked = FALSE
          AND et.used_at IS NULL
          AND et.expires_at > NOW()
        ORDER BY et.created_at DESC
        LIMIT 1
      ) AS active_token_expires_at,
      EXISTS (
        SELECT 1 FROM agent_credentials ac
        WHERE ac.integration_id = i.id
          AND ac.is_revoked = FALSE
      ) AS is_enrolled
    FROM integrations i
    WHERE i.id = $1 AND i.workspace_id = $2;
  `;

  const res = await pool.query(query, [integrationId, workspaceId]);
  if (res.rows.length === 0) {
    return null;
  }

  const row = res.rows[0];
  return {
    integrationId: row.id,
    integrationStatus: row.status,
    hasActiveToken: Boolean(row.has_active_token),
    tokenExpiresAt: row.active_token_expires_at || null,
    isEnrolled: Boolean(row.is_enrolled),
    agentId: row.agent_id,
    lastSeenAt: row.last_seen_at,
  };
}

/**
 * Atomically validate and consume an enrollment token on behalf of an enrolling agent.
 * Concurrency-safe: uses SELECT ... FOR UPDATE on enrollment_tokens to prevent double consumption.
 */
export async function consumeEnrollmentToken(
  rawToken: string,
  agentMetadata: Record<string, unknown> = {},
  clientIp?: string
): Promise<EnrollmentConsumptionResult> {
  if (!rawToken || typeof rawToken !== 'string' || !rawToken.startsWith('sentinel_enroll_')) {
    return { success: false, error: 'INVALID_TOKEN' };
  }

  const tokenHash = hashToken(rawToken);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Concurrency-safe atomic token lookup with row lock
    const tokenRes = await client.query(
      `SELECT id, integration_id, workspace_id, is_revoked, used_at, expires_at
       FROM enrollment_tokens 
       WHERE token_hash = $1 
       FOR UPDATE`,
      [tokenHash]
    );

    if (tokenRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, error: 'INVALID_TOKEN' };
    }

    const tokenRow = tokenRes.rows[0];

    // 2. Validate token state
    const isRevoked = Boolean(tokenRow.is_revoked);
    const isAlreadyUsed = tokenRow.used_at !== null;
    const isExpired = new Date(tokenRow.expires_at).getTime() <= Date.now();

    if (isRevoked || isAlreadyUsed || isExpired) {
      // Record failure audit entry without secrets
      await recordIntegrationAuditLog(client, {
        integrationId: tokenRow.integration_id,
        workspaceId: tokenRow.workspace_id,
        actorId: null,
        action: 'enrollment_failed',
        details: {
          reason: isRevoked ? 'token_revoked' : isAlreadyUsed ? 'token_already_consumed' : 'token_expired',
          clientIp: clientIp || 'unknown',
        },
      });

      await client.query('COMMIT');
      return { success: false, error: 'INVALID_TOKEN' };
    }

    // 3. Lock associated integration and verify not revoked
    const intRes = await client.query(
      `SELECT id, workspace_id, status, metadata 
       FROM integrations 
       WHERE id = $1 FOR UPDATE`,
      [tokenRow.integration_id]
    );

    if (intRes.rows.length === 0 || intRes.rows[0].status === 'revoked') {
      await recordIntegrationAuditLog(client, {
        integrationId: tokenRow.integration_id,
        workspaceId: tokenRow.workspace_id,
        actorId: null,
        action: 'enrollment_failed',
        details: {
          reason: 'integration_revoked_or_missing',
          clientIp: clientIp || 'unknown',
        },
      });

      await client.query('COMMIT');
      return { success: false, error: 'INVALID_TOKEN' };
    }

    // 4. Mark token consumed atomically
    await client.query(
      `UPDATE enrollment_tokens 
       SET used_at = NOW() 
       WHERE id = $1`,
      [tokenRow.id]
    );

    // 5. Generate unique agent identity & cryptographically secure agent credential
    const agentId = crypto.randomUUID();
    const rawAgentEntropy = crypto.randomBytes(32).toString('hex');
    const agentKey = `sentinel_agent_${rawAgentEntropy}`;
    const credentialHash = hashToken(agentKey);

    // 6. Invalidate previous active credentials for this integration if any
    await client.query(
      `UPDATE agent_credentials 
       SET is_revoked = TRUE, revoked_at = NOW() 
       WHERE integration_id = $1 AND is_revoked = FALSE`,
      [tokenRow.integration_id]
    );

    // 7. Store agent credential hash
    await client.query(
      `INSERT INTO agent_credentials (
         agent_id, integration_id, workspace_id, credential_hash
       ) VALUES ($1, $2, $3, $4)`,
      [agentId, tokenRow.integration_id, tokenRow.workspace_id, credentialHash]
    );

    // 8. Update integration state to 'connected' with agent metadata and last_seen_at
    const existingMetadata = intRes.rows[0].metadata || {};
    const mergedMetadata = {
      ...existingMetadata,
      agentEnrolledAt: new Date().toISOString(),
      agentMetadata: {
        hostname: agentMetadata.hostname || 'unknown-host',
        os: agentMetadata.os || 'Linux',
        arch: agentMetadata.arch || 'unknown',
        agentVersion: agentMetadata.agentVersion || '0.1.0',
      },
    };

    await client.query(
      `UPDATE integrations 
       SET agent_id = $1, 
           status = 'connected', 
           last_seen_at = NOW(), 
           metadata = $2, 
           updated_at = NOW()
       WHERE id = $3`,
      [agentId, JSON.stringify(mergedMetadata), tokenRow.integration_id]
    );

    // 9. Record audit logs
    await recordIntegrationAuditLog(client, {
      integrationId: tokenRow.integration_id,
      workspaceId: tokenRow.workspace_id,
      actorId: null,
      action: 'enrollment_token_consumed',
      details: {
        agentId,
        clientIp: clientIp || 'unknown',
      },
    });

    await recordIntegrationAuditLog(client, {
      integrationId: tokenRow.integration_id,
      workspaceId: tokenRow.workspace_id,
      actorId: null,
      action: 'agent_credential_issued',
      details: {
        agentId,
      },
    });

    await client.query('COMMIT');

    logger.info(
      { agentId, integrationId: tokenRow.integration_id, workspaceId: tokenRow.workspace_id },
      'Agent enrolled and credential issued'
    );

    return {
      success: true,
      agentId,
      agentKey,
      integrationId: tokenRow.integration_id,
      workspaceId: tokenRow.workspace_id,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error({ error: err instanceof Error ? err.message : String(err) }, 'Enrollment consumption failed');
    return { success: false, error: 'INTERNAL_ERROR' };
  } finally {
    client.release();
  }
}

/**
 * Revoke an integration's credentials and enrollment tokens.
 * Enforces immediate authentication invalidation for subsequent agent requests.
 */
export async function revokeIntegration(
  workspaceId: string,
  integrationId: string,
  userId: string
): Promise<{ success: boolean }> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Verify integration exists in workspace
    const intRes = await client.query(
      `SELECT id, status FROM integrations WHERE id = $1 AND workspace_id = $2 FOR UPDATE`,
      [integrationId, workspaceId]
    );

    if (intRes.rows.length === 0) {
      throw new Error('Integration not found.');
    }

    // 2. Revoke active enrollment tokens
    await client.query(
      `UPDATE enrollment_tokens 
       SET is_revoked = TRUE, revoked_at = NOW(), revoked_by = $1 
       WHERE integration_id = $2 AND is_revoked = FALSE`,
      [userId, integrationId]
    );

    // 3. Revoke active agent credentials
    await client.query(
      `UPDATE agent_credentials 
       SET is_revoked = TRUE, revoked_at = NOW(), revoked_by = $1 
       WHERE integration_id = $2 AND is_revoked = FALSE`,
      [userId, integrationId]
    );

    // 4. Update integration status to 'revoked'
    await client.query(
      `UPDATE integrations 
       SET status = 'revoked', updated_at = NOW() 
       WHERE id = $1`,
      [integrationId]
    );

    // 5. Audit log
    await recordIntegrationAuditLog(client, {
      integrationId,
      workspaceId,
      actorId: userId,
      action: 'agent_credential_revoked',
      details: {
        revokedBy: userId,
      },
    });

    await client.query('COMMIT');

    logger.info({ integrationId, workspaceId, revokedBy: userId }, 'Revoked integration credentials');

    return { success: true };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Authenticate agent credentials via constant-time SHA-256 comparison.
 * Verifies that the credential is valid, unrevoked, and active.
 */
export async function verifyAgentAuthentication(
  agentId: string,
  rawAgentKey: string
): Promise<AgentVerificationResult> {
  if (!agentId || !rawAgentKey || typeof rawAgentKey !== 'string') {
    return { valid: false, error: 'MISSING_CREDENTIALS' };
  }

  const query = `
    SELECT 
      ac.id,
      ac.agent_id,
      ac.integration_id,
      ac.workspace_id,
      ac.credential_hash,
      ac.is_revoked AS cred_revoked,
      i.status AS integration_status
    FROM agent_credentials ac
    JOIN integrations i ON ac.integration_id = i.id
    WHERE ac.agent_id = $1;
  `;

  const res = await pool.query(query, [agentId]);
  if (res.rows.length === 0) {
    return { valid: false, error: 'UNKNOWN_AGENT' };
  }

  const row = res.rows[0];

  if (row.cred_revoked || row.integration_status === 'revoked') {
    return { valid: false, error: 'CREDENTIAL_REVOKED' };
  }

  const providedHash = hashToken(rawAgentKey);
  const isValid = timingSafeMatch(row.credential_hash, providedHash);

  if (!isValid) {
    return { valid: false, error: 'INVALID_CREDENTIAL' };
  }

  // Update last seen and authenticated timestamps asynchronously
  pool.query(
    `UPDATE agent_credentials SET last_authenticated_at = NOW() WHERE id = $1`,
    [row.id]
  ).catch((e) => logger.error({ err: e }, 'Failed to update agent last_authenticated_at'));

  pool.query(
    `UPDATE integrations SET last_seen_at = NOW(), updated_at = NOW() WHERE id = $1`,
    [row.integration_id]
  ).catch((e) => logger.error({ err: e }, 'Failed to update integration last_seen_at'));

  return {
    valid: true,
    agentId: row.agent_id,
    integrationId: row.integration_id,
    workspaceId: row.workspace_id,
  };
}

