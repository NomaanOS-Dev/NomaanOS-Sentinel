import { Router, Request, Response, NextFunction } from 'express';
import { pool } from '../database/pool.js';
import { authenticate, requireVerified, requireWorkspaceMember } from '../middleware/auth.js';
import { createRateLimiter } from '../middleware/rate-limiter.js';
import {
  createIntegration,
  listIntegrations,
  getIntegrationDetail,
  createEnrollmentToken,
  inspectEnrollmentState,
  revokeIntegration,
  consumeEnrollmentToken,
  verifyAgentAuthentication,
  IntegrationType,
} from '../services/enrollment-service.js';
import { agentIngestService } from '../services/agent-ingest-service.js';
import { billingService } from '../services/billing-service.js';

export const integrationsRouter = Router({ mergeParams: true });
export const agentPublicRouter = Router();

const enrollmentRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 20,
  message: 'Too many enrollment attempts. Please try again shortly.',
});

// UUID regex for input validation
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type IntegrationHealthStatus =
  | 'connected'
  | 'degraded'
  | 'inactive'
  | 'disconnected'
  | 'revoked'
  | 'pending';

/**
 * Computes agent runtime health status against explicit threshold criteria:
 * - revoked: credentials revoked by administrator
 * - connected: seen within 5 minutes, no errors within 15 minutes
 * - degraded: seen within 15 minutes AND (error within 15m OR seen > 5m ago)
 * - inactive: seen between 15m and 24h ago
 * - disconnected: seen > 24h ago OR (unconnected and created > 15m ago)
 * - pending: enrolled token issued, never connected within 15m
 */
export function computeIntegrationHealth(row: {
  status: string;
  last_seen_at: string | Date | null;
  last_error_at: string | Date | null;
  created_at: string | Date;
}): IntegrationHealthStatus {
  if (row.status === 'revoked') {
    return 'revoked';
  }

  if (!row.last_seen_at) {
    const createdMs = new Date(row.created_at).getTime();
    const ageMs = Date.now() - createdMs;
    if (ageMs > 15 * 60 * 1000) {
      return 'disconnected';
    }
    return 'pending';
  }

  const lastSeenMs = new Date(row.last_seen_at).getTime();
  const timeSinceSeenMs = Date.now() - lastSeenMs;
  const lastErrorMs = row.last_error_at ? new Date(row.last_error_at).getTime() : 0;
  const recentError = lastErrorMs > 0 && Date.now() - lastErrorMs < 15 * 60 * 1000;

  if (timeSinceSeenMs <= 5 * 60 * 1000 && !recentError) {
    return 'connected';
  }

  if (timeSinceSeenMs <= 15 * 60 * 1000) {
    return 'degraded';
  }

  if (timeSinceSeenMs <= 24 * 60 * 60 * 1000) {
    return 'inactive';
  }

  return 'disconnected';
}

// ==========================================
// Workspace-Scoped Integration Management
// ==========================================

// 1. List Integrations for Workspace
integrationsRouter.get(
  '/',
  authenticate,
  requireWorkspaceMember('viewer'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceId = req.workspace!.id;
      const integrations = await listIntegrations(workspaceId);

      res.status(200).json({
        status: 'ok',
        workspaceId,
        total: integrations.length,
        integrations,
      });
    } catch (err) {
      next(err);
    }
  }
);

// 2. Create New Integration
integrationsRouter.post(
  '/',
  authenticate,
  requireVerified,
  requireWorkspaceMember('analyst'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceId = req.workspace!.id;
      const userId = req.user!.id;
      const { name, integrationType = 'linux_auth', metadata = {} } = req.body;

      if (!name || typeof name !== 'string' || name.trim().length === 0) {
        res.status(400).json({
          error: 'Validation Error',
          message: 'Integration name is required and cannot be empty.',
        });
        return;
      }

      if (name.trim().length > 255) {
        res.status(400).json({
          error: 'Validation Error',
          message: 'Integration name cannot exceed 255 characters.',
        });
        return;
      }

      if (integrationType !== 'linux_auth') {
        res.status(400).json({
          error: 'Validation Error',
          message: `Unsupported integration type: '${integrationType}'. The only currently supported type is 'linux_auth'.`,
        });
        return;
      }

      // Assert plan quota for registered integrations
      await billingService.assertQuota('workspace', workspaceId, 'integrations', 1);

      const integration = await createIntegration(
        workspaceId,
        userId,
        name.trim(),
        integrationType as IntegrationType,
        metadata && typeof metadata === 'object' ? metadata : {}
      );

      res.status(201).json({
        status: 'created',
        integration,
      });
    } catch (err) {
      next(err);
    }
  }
);

// 3. Integration Fleet Health and Ingestion Throughput Summary
integrationsRouter.get(
  '/health',
  authenticate,
  requireWorkspaceMember('viewer'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceId = req.workspace!.id;

      const integrationsQuery = `
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
          i.updated_at
        FROM integrations i
        LEFT JOIN users u ON i.created_by = u.id
        WHERE i.workspace_id = $1
        ORDER BY i.created_at DESC;
      `;

      const throughputQuery = `
        SELECT COUNT(*)::int AS count_24h
        FROM security_events
        WHERE tenant_id = $1 
          AND occurred_at >= NOW() - INTERVAL '24 hours'
          AND ingestion_source = 'linux_agent';
      `;

      const threatsQuery = `
        SELECT COUNT(*)::int AS active_threats
        FROM alerts
        WHERE workspace_id = $1 
          AND status IN ('open', 'in_progress');
      `;

      const [integrationsRes, throughputRes, threatsRes] = await Promise.all([
        pool.query(integrationsQuery, [workspaceId]),
        pool.query(throughputQuery, [workspaceId]),
        pool.query(threatsQuery, [workspaceId]),
      ]);

      const events24h = throughputRes.rows[0]?.count_24h || 0;
      const activeThreats = threatsRes.rows[0]?.active_threats || 0;

      const summary: Record<string, number> = {
        totalIntegrations: integrationsRes.rows.length,
        connected: 0,
        degraded: 0,
        inactive: 0,
        disconnected: 0,
        revoked: 0,
        pending: 0,
        events24h,
        activeThreats,
      };

      const integrations = integrationsRes.rows.map((row) => {
        const computedHealth = computeIntegrationHealth(row);
        if (summary[computedHealth] !== undefined) {
          summary[computedHealth]++;
        }

        return {
          id: row.id,
          workspaceId: row.workspace_id,
          name: row.name,
          integrationType: row.integration_type,
          status: row.status,
          healthStatus: computedHealth,
          agentId: row.agent_id,
          lastSeenAt: row.last_seen_at,
          lastErrorMessage: row.last_error_message,
          lastErrorAt: row.last_error_at,
          metadata: row.metadata || {},
          creatorEmail: row.creator_email,
          creatorName: row.creator_name,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        };
      });

      res.status(200).json({
        status: 'ok',
        workspaceId,
        summary,
        integrations,
      });
    } catch (err) {
      next(err);
    }
  }
);

// 4. Retrieve Integration Details & Audit History
integrationsRouter.get(
  '/:integrationId',
  authenticate,
  requireWorkspaceMember('viewer'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceId = req.workspace!.id;
      const integrationId = req.params.integrationId as string;

      if (!integrationId || !UUID_REGEX.test(integrationId)) {
        res.status(400).json({
          error: 'Bad Request',
          message: 'A valid integration UUID is required.',
        });
        return;
      }

      const result = await getIntegrationDetail(workspaceId, integrationId);
      if (!result) {
        res.status(404).json({
          error: 'Not Found',
          message: 'Integration not found in this workspace.',
        });
        return;
      }

      res.status(200).json({
        status: 'ok',
        workspaceId,
        integration: result.integration,
        auditLogs: result.auditLogs,
      });
    } catch (err) {
      next(err);
    }
  }
);

// 5. Generate Single-Use Enrollment Token
integrationsRouter.post(
  '/:integrationId/enrollment',
  authenticate,
  requireVerified,
  requireWorkspaceMember('admin'),
  enrollmentRateLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceId = req.workspace!.id;
      const userId = req.user!.id;
      const integrationId = req.params.integrationId as string;

      if (!integrationId || !UUID_REGEX.test(integrationId)) {
        res.status(400).json({
          error: 'Bad Request',
          message: 'A valid integration UUID is required.',
        });
        return;
      }

      const tokenResult = await createEnrollmentToken(workspaceId, integrationId, userId);

      res.status(201).json({
        ...tokenResult,
        status: 'created',
        enrollment: tokenResult,
      });
    } catch (err: unknown) {
      if (err instanceof Error) {
        if (err.message.includes('not found') || err.message === 'INTEGRATION_NOT_FOUND') {
          res.status(404).json({
            error: 'Not Found',
            message: 'Integration not found in this workspace.',
          });
          return;
        }
        if (err.message.includes('revoked') || err.message === 'INTEGRATION_REVOKED') {
          res.status(400).json({
            error: 'Bad Request',
            message: 'Cannot issue an enrollment token for a revoked integration.',
          });
          return;
        }
      }
      next(err);
    }
  }
);

// 6. Inspect Enrollment Token State
integrationsRouter.get(
  '/:integrationId/enrollment',
  authenticate,
  requireWorkspaceMember('viewer'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceId = req.workspace!.id;
      const integrationId = req.params.integrationId as string;

      if (!integrationId || !UUID_REGEX.test(integrationId)) {
        res.status(400).json({
          error: 'Bad Request',
          message: 'A valid integration UUID is required.',
        });
        return;
      }

      const state = await inspectEnrollmentState(workspaceId, integrationId);

      if (!state) {
        res.status(404).json({
          error: 'Not Found',
          message: 'Integration not found in this workspace.',
        });
        return;
      }

      res.status(200).json({
        status: 'ok',
        workspaceId,
        integrationId,
        enrollment: state,
        enrollmentState: state,
      });
    } catch (err) {
      next(err);
    }
  }
);

// 7. Revoke Integration
integrationsRouter.post(
  '/:integrationId/revoke',
  authenticate,
  requireVerified,
  requireWorkspaceMember('admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceId = req.workspace!.id;
      const userId = req.user!.id;
      const integrationId = req.params.integrationId as string;

      if (!integrationId || !UUID_REGEX.test(integrationId)) {
        res.status(400).json({
          error: 'Bad Request',
          message: 'A valid integration UUID is required.',
        });
        return;
      }

      await revokeIntegration(workspaceId, integrationId, userId);

      res.status(200).json({
        status: 'ok',
        workspaceId,
        integrationId,
        revoked: true,
        message: 'Integration and all active credentials successfully revoked.',
      });
    } catch (err: unknown) {
      if (err instanceof Error && (err.message.includes('not found') || err.message === 'INTEGRATION_NOT_FOUND')) {
        res.status(404).json({
          error: 'Not Found',
          message: 'Integration not found in this workspace.',
        });
        return;
      }
      next(err);
    }
  }
);

// ==========================================
// Public Agent-Facing Endpoints
// ==========================================

// 8. Consume Enrollment Token (Agent Registration)
agentPublicRouter.post(
  '/enroll',
  enrollmentRateLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { enrollmentToken, agentMetadata } = req.body;

      if (!enrollmentToken || typeof enrollmentToken !== 'string') {
        res.status(400).json({
          error: 'Bad Request',
          message: 'enrollmentToken is required.',
        });
        return;
      }

      const clientIp = req.ip || (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress;

      const result = await consumeEnrollmentToken(
        enrollmentToken.trim(),
        agentMetadata && typeof agentMetadata === 'object' ? agentMetadata : {},
        clientIp
      );

      if (!result.success) {
        res.status(401).json({
          error: 'Unauthorized',
          message: 'Invalid, expired, or revoked enrollment token.',
        });
        return;
      }

      res.status(200).json({
        status: 'ok',
        agentId: result.agentId,
        agentKey: result.agentKey,
        integrationId: result.integrationId,
        workspaceId: result.workspaceId,
        message: 'Agent enrolled successfully.',
      });
    } catch (err) {
      next(err);
    }
  }
);

// 9. Agent Credential Heartbeat & Authentication Proving with Telemetry Diagnostics
agentPublicRouter.post(
  '/agent/heartbeat',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const authHeader = req.headers.authorization;
      const agentId = (req.headers['x-agent-id'] || req.body?.agentId) as string;

      let agentKey: string | undefined;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        agentKey = authHeader.slice(7).trim();
      } else if (req.body?.agentKey) {
        agentKey = req.body.agentKey;
      }

      if (!agentId || !agentKey) {
        res.status(401).json({
          error: 'Unauthorized',
          message: 'Agent ID and Bearer agent credentials are required.',
        });
        return;
      }

      const result = await verifyAgentAuthentication(agentId, agentKey);

      if (!result.valid) {
        res.status(401).json({
          error: 'Unauthorized',
          message: 'Invalid or revoked agent credentials.',
        });
        return;
      }

      // Record optional diagnostics telemetry
      if (req.body?.diagnostics && typeof req.body.diagnostics === 'object') {
        const diag = req.body.diagnostics;
        const lastErrorMessage = diag.last_error || diag.lastErrorMessage || null;
        await pool.query(
          `UPDATE integrations 
           SET metadata = metadata || $1::jsonb,
               last_error_message = COALESCE($2, last_error_message),
               last_error_at = CASE WHEN $2 IS NOT NULL THEN NOW() ELSE last_error_at END,
               updated_at = NOW()
           WHERE id = $3`,
          [
            JSON.stringify({ agentDiagnostics: diag, lastHeartbeatDiagnosticsAt: new Date().toISOString() }),
            lastErrorMessage,
            result.integrationId,
          ]
        );
      }

      res.status(200).json({
        status: 'ok',
        agentId: result.agentId,
        integrationId: result.integrationId,
        workspaceId: result.workspaceId,
        message: 'Heartbeat acknowledged.',
        serverTime: new Date().toISOString(),
      });
    } catch (err) {
      next(err);
    }
  }
);

// 10. Agent Batch Event Ingestion with Deduplication & Itemized Feedback
agentPublicRouter.post(
  '/agent/events',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const authHeader = req.headers.authorization;
      const agentId = (req.headers['x-agent-id'] || req.body?.agentId) as string;

      let agentKey: string | undefined;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        agentKey = authHeader.slice(7).trim();
      } else if (req.body?.agentKey) {
        agentKey = req.body.agentKey;
      }

      if (!agentId || !agentKey) {
        res.status(401).json({
          error: 'Unauthorized',
          message: 'Agent ID and Bearer agent credentials are required.',
        });
        return;
      }

      const verified = await verifyAgentAuthentication(agentId, agentKey);
      if (!verified.valid) {
        res.status(401).json({
          error: 'Unauthorized',
          message: 'Invalid or revoked agent credentials.',
        });
        return;
      }

      const { batchId, events } = req.body;
      if (!events || !Array.isArray(events) || events.length === 0) {
        res.status(400).json({
          error: 'Bad Request',
          message: 'Payload must contain a non-empty events array.',
        });
        return;
      }

      if (events.length > 100) {
        res.status(400).json({
          error: 'Bad Request',
          message: 'Batch size exceeds maximum limit of 100 events.',
        });
        return;
      }

      const ingestResult = await agentIngestService.ingestBatch(
        verified.workspaceId!,
        verified.integrationId!,
        events,
        batchId
      );

      if (ingestResult.batchStatus === 'rejected') {
        const details = ingestResult.items
          .filter((it) => it.status === 'rejected')
          .map((it) => it.reason || 'Schema validation failed');

        res.status(422).json({
          error: 'SCHEMA_VALIDATION_ERROR',
          message: 'All events in batch failed canonical schema validation.',
          batchStatus: 'rejected',
          batchId: ingestResult.batchId,
          total: ingestResult.total,
          acceptedCount: 0,
          duplicateCount: 0,
          rejectedCount: ingestResult.rejectedCount,
          details,
          items: ingestResult.items,
        });
        return;
      }

      res.status(200).json({
        status: 'ok',
        batchStatus: ingestResult.batchStatus,
        batchId: ingestResult.batchId,
        total: ingestResult.total,
        acceptedCount: ingestResult.acceptedCount,
        newlyAcceptedCount: ingestResult.newlyAcceptedCount,
        duplicateCount: ingestResult.duplicateCount,
        rejectedCount: ingestResult.rejectedCount,
        alertsGenerated: ingestResult.alertsGenerated,
        items: ingestResult.items,
        message:
          ingestResult.batchStatus === 'partially_accepted'
            ? 'Batch partially accepted; some events were duplicate or rejected.'
            : 'Batch accepted',
      });
    } catch (err: unknown) {
      if (err instanceof Error && err.message.startsWith('VALIDATION_ERROR:')) {
        res.status(400).json({
          error: 'Bad Request',
          message: err.message.replace('VALIDATION_ERROR: ', ''),
        });
        return;
      }
      next(err);
    }
  }
);
