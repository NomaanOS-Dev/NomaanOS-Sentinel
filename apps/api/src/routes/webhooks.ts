// apps/api/src/routes/webhooks.ts
// Workspace-Scoped Outbound Webhooks Configuration and Delivery Audit Log

import { Router, Request, Response, NextFunction } from 'express';
import { authenticate, requireVerified, requireWorkspaceMember } from '../middleware/auth.js';
import { pool } from '../database/pool.js';
import { webhookDispatcher } from '../services/webhook-dispatcher.js';
import { ssrfValidator } from '../services/ssrf-validator.js';
import { billingService } from '../services/billing-service.js';
import { logger } from '../config/logger.js';

export const webhooksRouter = Router({ mergeParams: true });

const VALID_SEVERITIES = ['info', 'low', 'medium', 'high', 'critical'];

function redactSecret(secret: string): string {
  if (!secret || secret.length < 12) return 'whsec_****';
  return `${secret.substring(0, 8)}...${secret.substring(secret.length - 4)}`;
}

// 1. List Workspace Webhooks
webhooksRouter.get(
  '/',
  authenticate,
  requireWorkspaceMember('viewer'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceId = req.workspace!.id;

      const result = await pool.query(
        `SELECT 
          id, workspace_id, name, url, signing_secret, secret_last_rotated_at,
          enabled, min_severity, subscribed_rules, created_by, created_at, updated_at
         FROM workspace_webhooks
         WHERE workspace_id = $1
         ORDER BY created_at DESC`,
        [workspaceId]
      );

      res.status(200).json({
        status: 'ok',
        webhooks: result.rows.map((r) => ({
          id: r.id,
          workspaceId: r.workspace_id,
          name: r.name,
          url: r.url,
          signingSecretMasked: redactSecret(r.signing_secret),
          secretLastRotatedAt: r.secret_last_rotated_at,
          enabled: r.enabled,
          minSeverity: r.min_severity,
          subscribedRules: r.subscribed_rules,
          createdBy: r.created_by,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
        })),
      });
    } catch (err) {
      next(err);
    }
  }
);

// 2. Create Workspace Webhook
webhooksRouter.post(
  '/',
  authenticate,
  requireVerified,
  requireWorkspaceMember('admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceId = req.workspace!.id;
      const { name, url, minSeverity = 'low', subscribedRules = [] } = req.body;

      // Quota check: Ensure plan supports outbound webhooks
      await billingService.assertQuota('workspace', workspaceId, 'feature_webhooks');

      if (!name || typeof name !== 'string' || name.trim().length === 0) {
        res.status(400).json({ error: 'Validation Error', message: 'Webhook name is required.' });
        return;
      }

      if (!url || typeof url !== 'string' || url.trim().length === 0) {
        res.status(400).json({ error: 'Validation Error', message: 'Webhook destination URL is required.' });
        return;
      }

      if (!VALID_SEVERITIES.includes(minSeverity)) {
        res.status(400).json({
          error: 'Validation Error',
          message: `Invalid minSeverity '${minSeverity}'. Must be one of: ${VALID_SEVERITIES.join(', ')}.`,
        });
        return;
      }

      // Pre-flight SSRF Validation
      const ssrfCheck = await ssrfValidator.validateWebhookDestination(url.trim());
      if (!ssrfCheck.valid) {
        res.status(400).json({
          error: 'SSRF_VALIDATION_ERROR',
          message: `Destination URL rejected by security policy: ${ssrfCheck.reason}`,
        });
        return;
      }

      const signingSecret = webhookDispatcher.generateSecret();

      const insertRes = await pool.query(
        `INSERT INTO workspace_webhooks (
          workspace_id, name, url, signing_secret, enabled, min_severity,
          subscribed_rules, created_by
        ) VALUES ($1, $2, $3, $4, TRUE, $5, $6, $7)
        RETURNING *;`,
        [
          workspaceId,
          name.trim(),
          url.trim(),
          signingSecret,
          minSeverity,
          Array.isArray(subscribedRules) ? subscribedRules : [],
          req.user!.id,
        ]
      );

      const r = insertRes.rows[0];

      logger.info({ workspaceId, webhookId: r.id, url: r.url }, 'Created outbound alert webhook');

      // Note: Full signingSecret is returned ONLY once on initial creation
      res.status(201).json({
        status: 'created',
        webhook: {
          id: r.id,
          workspaceId: r.workspace_id,
          name: r.name,
          url: r.url,
          signingSecret, // Revealed only upon creation
          signingSecretMasked: redactSecret(signingSecret),
          secretLastRotatedAt: r.secret_last_rotated_at,
          enabled: r.enabled,
          minSeverity: r.min_severity,
          subscribedRules: r.subscribed_rules,
          createdAt: r.created_at,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// 3. Get Webhook Details
webhooksRouter.get(
  '/:webhookId',
  authenticate,
  requireWorkspaceMember('viewer'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const webhookId = String(req.params.webhookId);
      const workspaceId = req.workspace!.id;

      const result = await pool.query(
        `SELECT 
          id, workspace_id, name, url, signing_secret, secret_last_rotated_at,
          enabled, min_severity, subscribed_rules, created_by, created_at, updated_at
         FROM workspace_webhooks
         WHERE id = $1 AND workspace_id = $2`,
        [webhookId, workspaceId]
      );

      if (result.rows.length === 0) {
        res.status(404).json({ error: 'Not Found', message: 'Webhook not found in this workspace.' });
        return;
      }

      const r = result.rows[0];
      res.status(200).json({
        status: 'ok',
        webhook: {
          id: r.id,
          workspaceId: r.workspace_id,
          name: r.name,
          url: r.url,
          signingSecretMasked: redactSecret(r.signing_secret),
          secretLastRotatedAt: r.secret_last_rotated_at,
          enabled: r.enabled,
          minSeverity: r.min_severity,
          subscribedRules: r.subscribed_rules,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// 4. Update Webhook Configuration
webhooksRouter.patch(
  '/:webhookId',
  authenticate,
  requireVerified,
  requireWorkspaceMember('admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const webhookId = String(req.params.webhookId);
      const workspaceId = req.workspace!.id;
      const { name, url, enabled, minSeverity, subscribedRules } = req.body;

      const existingRes = await pool.query(
        `SELECT id FROM workspace_webhooks WHERE id = $1 AND workspace_id = $2`,
        [webhookId, workspaceId]
      );

      if (existingRes.rows.length === 0) {
        res.status(404).json({ error: 'Not Found', message: 'Webhook not found in this workspace.' });
        return;
      }

      const updates: string[] = [];
      const values: any[] = [webhookId, workspaceId];
      let idx = 3;

      if (name !== undefined) {
        if (typeof name !== 'string' || name.trim().length === 0) {
          res.status(400).json({ error: 'Validation Error', message: 'Webhook name cannot be empty.' });
          return;
        }
        updates.push(`name = $${idx++}`);
        values.push(name.trim());
      }

      if (url !== undefined) {
        const ssrfCheck = await ssrfValidator.validateWebhookDestination(url.trim());
        if (!ssrfCheck.valid) {
          res.status(400).json({
            error: 'SSRF_VALIDATION_ERROR',
            message: `Destination URL rejected by security policy: ${ssrfCheck.reason}`,
          });
          return;
        }
        updates.push(`url = $${idx++}`);
        values.push(url.trim());
      }

      if (enabled !== undefined) {
        updates.push(`enabled = $${idx++}`);
        values.push(Boolean(enabled));
      }

      if (minSeverity !== undefined) {
        if (!VALID_SEVERITIES.includes(minSeverity)) {
          res.status(400).json({ error: 'Validation Error', message: `Invalid minSeverity '${minSeverity}'.` });
          return;
        }
        updates.push(`min_severity = $${idx++}`);
        values.push(minSeverity);
      }

      if (subscribedRules !== undefined) {
        updates.push(`subscribed_rules = $${idx++}`);
        values.push(Array.isArray(subscribedRules) ? subscribedRules : []);
      }

      if (updates.length === 0) {
        res.status(400).json({ error: 'Validation Error', message: 'No valid fields provided to update.' });
        return;
      }

      updates.push(`updated_at = NOW()`);

      const updateRes = await pool.query(
        `UPDATE workspace_webhooks 
         SET ${updates.join(', ')} 
         WHERE id = $1 AND workspace_id = $2 
         RETURNING *;`,
        values
      );

      const r = updateRes.rows[0];
      res.status(200).json({
        status: 'ok',
        webhook: {
          id: r.id,
          workspaceId: r.workspace_id,
          name: r.name,
          url: r.url,
          signingSecretMasked: redactSecret(r.signing_secret),
          secretLastRotatedAt: r.secret_last_rotated_at,
          enabled: r.enabled,
          minSeverity: r.min_severity,
          subscribedRules: r.subscribed_rules,
          updatedAt: r.updated_at,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// 5. Rotate Webhook Signing Secret
webhooksRouter.post(
  '/:webhookId/rotate-secret',
  authenticate,
  requireVerified,
  requireWorkspaceMember('admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const webhookId = String(req.params.webhookId);
      const workspaceId = req.workspace!.id;

      const newSecret = webhookDispatcher.generateSecret();

      const updateRes = await pool.query(
        `UPDATE workspace_webhooks 
         SET signing_secret = $1, secret_last_rotated_at = NOW(), updated_at = NOW()
         WHERE id = $2 AND workspace_id = $3
         RETURNING id, name, secret_last_rotated_at;`,
        [newSecret, webhookId, workspaceId]
      );

      if (updateRes.rows.length === 0) {
        res.status(404).json({ error: 'Not Found', message: 'Webhook not found in this workspace.' });
        return;
      }

      logger.info({ workspaceId, webhookId }, 'Rotated webhook signing secret');

      res.status(200).json({
        status: 'ok',
        message: 'Webhook signing secret rotated successfully.',
        signingSecret: newSecret, // Returned once upon rotation
        signingSecretMasked: redactSecret(newSecret),
        secretLastRotatedAt: updateRes.rows[0].secret_last_rotated_at,
      });
    } catch (err) {
      next(err);
    }
  }
);

// 6. Delete Webhook
webhooksRouter.delete(
  '/:webhookId',
  authenticate,
  requireVerified,
  requireWorkspaceMember('admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const webhookId = String(req.params.webhookId);
      const workspaceId = req.workspace!.id;

      const delRes = await pool.query(
        `DELETE FROM workspace_webhooks WHERE id = $1 AND workspace_id = $2 RETURNING id;`,
        [webhookId, workspaceId]
      );

      if (delRes.rows.length === 0) {
        res.status(404).json({ error: 'Not Found', message: 'Webhook not found in this workspace.' });
        return;
      }

      res.status(200).json({ status: 'ok', message: 'Webhook deleted successfully.' });
    } catch (err) {
      next(err);
    }
  }
);

// 7. Test Webhook Connectivity
webhooksRouter.post(
  '/:webhookId/test',
  authenticate,
  requireVerified,
  requireWorkspaceMember('admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const webhookId = String(req.params.webhookId);
      const workspaceId = req.workspace!.id;

      const delivery = await webhookDispatcher.testWebhookEndpoint(webhookId, workspaceId);

      res.status(200).json({
        status: 'ok',
        message: delivery.status === 'delivered' ? 'Test webhook delivered successfully.' : 'Webhook test delivery failed.',
        delivery,
      });
    } catch (err) {
      next(err);
    }
  }
);

// 8. List Webhook Delivery History
webhooksRouter.get(
  '/:webhookId/deliveries',
  authenticate,
  requireWorkspaceMember('viewer'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const webhookId = String(req.params.webhookId);
      const workspaceId = req.workspace!.id;
      const limit = Math.min(Math.max(parseInt(String(req.query.limit || 50), 10) || 50, 1), 100);
      const offset = Math.max(parseInt(String(req.query.offset || 0), 10) || 0, 0);

      // Verify webhook belongs to workspace
      const hookCheck = await pool.query(
        `SELECT id FROM workspace_webhooks WHERE id = $1 AND workspace_id = $2`,
        [webhookId, workspaceId]
      );

      if (hookCheck.rows.length === 0) {
        res.status(404).json({ error: 'Not Found', message: 'Webhook not found in this workspace.' });
        return;
      }

      const deliveriesRes = await pool.query(
        `SELECT 
          id, webhook_id, workspace_id, event_id, alert_id,
          status, http_status_code, attempt_count, max_attempts,
          next_retry_at, last_attempt_at, delivered_at, error_message,
          response_body_snippet, created_at
         FROM webhook_deliveries
         WHERE webhook_id = $1 AND workspace_id = $2
         ORDER BY created_at DESC
         LIMIT $3 OFFSET $4;`,
        [webhookId, workspaceId, limit, offset]
      );

      res.status(200).json({
        status: 'ok',
        webhookId,
        total: deliveriesRes.rows.length,
        deliveries: deliveriesRes.rows.map((d) => ({
          id: d.id,
          webhookId: d.webhook_id,
          eventId: d.event_id,
          alertId: d.alert_id,
          status: d.status,
          httpStatusCode: d.http_status_code,
          attemptCount: d.attempt_count,
          lastAttemptAt: d.last_attempt_at,
          deliveredAt: d.delivered_at,
          errorMessage: d.error_message,
          responseSnippet: d.response_body_snippet,
          createdAt: d.created_at,
        })),
      });
    } catch (err) {
      next(err);
    }
  }
);

// 9. Retry Failed Webhook Delivery
webhooksRouter.post(
  '/:webhookId/deliveries/:deliveryId/retry',
  authenticate,
  requireVerified,
  requireWorkspaceMember('admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const webhookId = String(req.params.webhookId);
      const deliveryId = String(req.params.deliveryId);
      const workspaceId = req.workspace!.id;

      const delivery = await webhookDispatcher.retryDelivery(deliveryId, webhookId, workspaceId);

      res.status(200).json({
        status: 'ok',
        message: delivery.status === 'delivered' ? 'Webhook delivery succeeded on retry.' : 'Webhook retry attempted.',
        delivery,
      });
    } catch (err) {
      next(err);
    }
  }
);
