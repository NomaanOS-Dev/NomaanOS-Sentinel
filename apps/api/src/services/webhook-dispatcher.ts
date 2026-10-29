// apps/api/src/services/webhook-dispatcher.ts
// Outbound Alert Webhook Signing, SSRF Protection, and Asynchronous Delivery Worker

import crypto from 'crypto';
import { pool } from '../database/pool.js';
import { logger } from '../config/logger.js';
import { config } from '../config/env.js';
import { ssrfValidator } from './ssrf-validator.js';

export interface WebhookConfig {
  id: string;
  workspaceId: string;
  name: string;
  url: string;
  signingSecret: string;
  secretLastRotatedAt: string;
  enabled: boolean;
  minSeverity: 'info' | 'low' | 'medium' | 'high' | 'critical';
  subscribedRules: string[];
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WebhookDeliveryRecord {
  id: string;
  webhookId: string;
  workspaceId: string;
  eventId: string;
  alertId: string | null;
  status: 'pending' | 'delivered' | 'failed' | 'retrying' | 'blocked_ssrf';
  httpStatusCode: number | null;
  attemptCount: number;
  maxAttempts: number;
  nextRetryAt: string | null;
  lastAttemptAt: string;
  deliveredAt: string | null;
  errorMessage: string | null;
  responseBodySnippet: string | null;
  createdAt: string;
}

export interface WebhookAlertPayload {
  event_type: 'security_alert.created' | 'security_alert.updated' | 'security_alert.test';
  timestamp: string;
  delivery_id: string;
  workspace_id: string;
  alert: {
    id: string;
    rule_id: string;
    rule_name: string;
    severity: string;
    title: string;
    summary: string;
    reason: string;
    status: string;
    first_event_at: string;
    last_event_at: string;
    event_count: number;
    metadata: Record<string, unknown>;
  };
}

const SEVERITY_ORDER: Record<string, number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

export class WebhookDispatcher {
  /**
   * Generates a cryptographically strong signing secret for webhook verification.
   */
  public generateSecret(): string {
    return `whsec_${crypto.randomBytes(24).toString('hex')}`;
  }

  /**
   * Deterministically signs the webhook payload using HMAC-SHA256.
   * Standard format: t={timestamp},v1={hmac_sha256}
   */
  public signPayload(payloadJson: string, secret: string, timestamp: number): { header: string; signature: string } {
    const signature = crypto
      .createHmac('sha256', secret)
      .update(`${timestamp}.${payloadJson}`)
      .digest('hex');

    return {
      signature,
      header: `t=${timestamp},v1=${signature}`,
    };
  }

  /**
   * Verifies an outbound webhook payload on the recipient end.
   * Documented reference verification algorithm for consumers.
   */
  public verifyRecipientSignature(
    rawBody: string,
    signatureHeader: string,
    secret: string,
    toleranceSeconds = 300 // 5-minute replay window
  ): { valid: boolean; reason?: string } {
    const parts = signatureHeader.split(',');
    const timestampPart = parts.find((p) => p.startsWith('t='));
    const sigPart = parts.find((p) => p.startsWith('v1='));

    if (!timestampPart || !sigPart) {
      return { valid: false, reason: 'Malformed signature header. Missing t= or v1= component.' };
    }

    const timestamp = parseInt(timestampPart.replace('t=', ''), 10);
    const providedSig = sigPart.replace('v1=', '');

    if (isNaN(timestamp)) {
      return { valid: false, reason: 'Invalid timestamp format.' };
    }

    const currentEpoch = Math.floor(Date.now() / 1000);
    if (Math.abs(currentEpoch - timestamp) > toleranceSeconds) {
      return { valid: false, reason: 'Webhook timestamp outside acceptable replay window.' };
    }

    const expectedSig = crypto
      .createHmac('sha256', secret)
      .update(`${timestamp}.${rawBody}`)
      .digest('hex');

    const expectedBuf = Buffer.from(expectedSig, 'utf-8');
    const providedBuf = Buffer.from(providedSig, 'utf-8');

    if (expectedBuf.length !== providedBuf.length || !crypto.timingSafeEqual(expectedBuf, providedBuf)) {
      return { valid: false, reason: 'Cryptographic signature mismatch.' };
    }

    return { valid: true };
  }

  /**
   * Performs an outbound delivery attempt to a webhook destination.
   */
  public async deliverPayload(
    webhook: { id: string; workspace_id: string; url: string; signing_secret: string },
    alertId: string | null,
    payload: WebhookAlertPayload,
    deliveryId: string,
    attemptNumber = 1
  ): Promise<WebhookDeliveryRecord> {
    const serialized = JSON.stringify(payload);
    const timestamp = Math.floor(Date.now() / 1000);
    const { header } = this.signPayload(serialized, webhook.signing_secret, timestamp);

    // 1. SSRF Pre-flight Validation
    const ssrfCheck = await ssrfValidator.validateWebhookDestination(webhook.url);
    if (!ssrfCheck.valid) {
      logger.warn(
        { webhookId: webhook.id, url: webhook.url, reason: ssrfCheck.reason },
        'Outbound webhook delivery blocked by SSRF protection'
      );

      const recordRes = await pool.query(
        `INSERT INTO webhook_deliveries (
          webhook_id, workspace_id, event_id, alert_id, payload,
          status, attempt_count, last_attempt_at, error_message
        ) VALUES (
          $1, $2, $3, $4, $5,
          'blocked_ssrf', $6, NOW(), $7
        )
        ON CONFLICT (webhook_id, event_id) DO UPDATE SET
          status = 'blocked_ssrf',
          attempt_count = EXCLUDED.attempt_count,
          last_attempt_at = NOW(),
          error_message = EXCLUDED.error_message
        RETURNING *;`,
        [
          webhook.id,
          webhook.workspace_id,
          deliveryId,
          alertId,
          serialized,
          attemptNumber,
          `SSRF_BLOCKED: ${ssrfCheck.reason}`,
        ]
      );

      return this.mapDeliveryRow(recordRes.rows[0]);
    }

    // 2. HTTP Dispatch with Timeout & Non-redirecting Fetch
    let httpStatus: number | null = null;
    let snippet: string | null = null;
    let errorMessage: string | null = null;
    let status: 'delivered' | 'retrying' | 'failed' = 'failed';
    const timeoutMs = config.outboundWebhooks.timeoutMs;

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetch(webhook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'NomaanOS-Sentinel-Webhooks/1.0',
          'X-Sentinel-Delivery-Id': deliveryId,
          'X-Sentinel-Timestamp': String(timestamp),
          'X-Sentinel-Signature': header,
        },
        body: serialized,
        redirect: 'manual', // Strictly refuse following arbitrary redirects to prevent SSRF bypass
        signal: controller.signal,
      });

      clearTimeout(timer);
      httpStatus = response.status;

      // Read bounded snippet of response body
      const text = await response.text();
      snippet = text ? text.substring(0, 512).replace(/[\r\n]+/g, ' ').trim() : null;

      if (response.ok) {
        status = 'delivered';
      } else {
        errorMessage = `HTTP error response: ${response.status} ${response.statusText}`;
        // 5xx and 429 are retryable; 4xx client errors are permanent
        status = (response.status >= 500 || response.status === 429) && attemptNumber < config.outboundWebhooks.maxRetries
          ? 'retrying'
          : 'failed';
      }
    } catch (fetchErr: any) {
      if (fetchErr.name === 'AbortError') {
        errorMessage = `Request timed out after ${timeoutMs}ms`;
      } else {
        errorMessage = `Network delivery failure: ${fetchErr.message || String(fetchErr)}`;
      }
      status = attemptNumber < config.outboundWebhooks.maxRetries ? 'retrying' : 'failed';
    }

    // 3. Compute retry interval with exponential backoff & jitter
    let nextRetryAt: Date | null = null;
    if (status === 'retrying') {
      const baseDelaySeconds = Math.pow(attemptNumber, 2) * 5; // attempt 1 -> 5s, attempt 2 -> 20s
      const jitterSeconds = Math.floor(Math.random() * 3);
      nextRetryAt = new Date(Date.now() + (baseDelaySeconds + jitterSeconds) * 1000);
    }

    // 4. Record delivery result
    const upsertRes = await pool.query(
      `INSERT INTO webhook_deliveries (
        webhook_id, workspace_id, event_id, alert_id, payload,
        status, http_status_code, attempt_count, max_attempts,
        next_retry_at, last_attempt_at, delivered_at, error_message,
        response_body_snippet
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9,
        $10, NOW(), $11, $12,
        $13
      )
      ON CONFLICT (webhook_id, event_id) DO UPDATE SET
        status = EXCLUDED.status,
        http_status_code = EXCLUDED.http_status_code,
        attempt_count = EXCLUDED.attempt_count,
        next_retry_at = EXCLUDED.next_retry_at,
        last_attempt_at = NOW(),
        delivered_at = EXCLUDED.delivered_at,
        error_message = EXCLUDED.error_message,
        response_body_snippet = EXCLUDED.response_body_snippet
      RETURNING *;`,
      [
        webhook.id,
        webhook.workspace_id,
        deliveryId,
        alertId,
        serialized,
        status,
        httpStatus,
        attemptNumber,
        config.outboundWebhooks.maxRetries,
        nextRetryAt,
        status === 'delivered' ? new Date() : null,
        errorMessage,
        snippet,
      ]
    );

    return this.mapDeliveryRow(upsertRes.rows[0]);
  }

  /**
   * Asynchronously dispatches security alert events to all qualifying workspace webhooks.
   */
  public async dispatchAlertWebhooks(workspaceId: string, alertIds: string[]): Promise<void> {
    if (!alertIds || alertIds.length === 0) return;

    // Fetch active webhooks for this workspace
    const webhooksRes = await pool.query(
      `SELECT id, workspace_id, url, signing_secret, min_severity, subscribed_rules 
       FROM workspace_webhooks 
       WHERE workspace_id = $1 AND enabled = TRUE`,
      [workspaceId]
    );

    if (webhooksRes.rows.length === 0) return;

    // Fetch alert details
    const alertsRes = await pool.query(
      `SELECT 
         id, rule_id, rule_name, severity, title, summary,
         reason, status, first_event_at, last_event_at,
         event_count, metadata
       FROM alerts
       WHERE workspace_id = $1 AND id = ANY($2::uuid[])`,
      [workspaceId, alertIds]
    );

    for (const alert of alertsRes.rows) {
      const alertSeverityWeight = SEVERITY_ORDER[alert.severity] || 0;

      for (const hook of webhooksRes.rows) {
        const hookMinWeight = SEVERITY_ORDER[hook.min_severity] || 0;
        if (alertSeverityWeight < hookMinWeight) {
          continue; // Filtered by severity threshold
        }

        if (hook.subscribed_rules && hook.subscribed_rules.length > 0) {
          if (!hook.subscribed_rules.includes(alert.rule_name) && !hook.subscribed_rules.includes(alert.rule_id)) {
            continue; // Filtered by rule filter
          }
        }

        const deliveryId = `del_${crypto.randomUUID()}`;
        const payload: WebhookAlertPayload = {
          event_type: 'security_alert.created',
          timestamp: new Date().toISOString(),
          delivery_id: deliveryId,
          workspace_id: workspaceId,
          alert: {
            id: alert.id,
            rule_id: alert.rule_id,
            rule_name: alert.rule_name,
            severity: alert.severity,
            title: alert.title,
            summary: alert.summary,
            reason: alert.reason,
            status: alert.status,
            first_event_at: alert.first_event_at,
            last_event_at: alert.last_event_at,
            event_count: alert.event_count,
            metadata: alert.metadata || {},
          },
        };

        // Fire delivery asynchronously without blocking alert detection pipeline
        this.deliverPayload(hook, alert.id, payload, deliveryId, 1).catch((err) => {
          logger.error({ err, webhookId: hook.id, alertId: alert.id }, 'Async webhook delivery dispatch failed');
        });
      }
    }
  }

  /**
   * Dispatches a signed test ping to verify webhook connectivity and recipient HMAC validation.
   */
  public async testWebhookEndpoint(webhookId: string, workspaceId: string): Promise<WebhookDeliveryRecord> {
    const hookRes = await pool.query(
      `SELECT id, workspace_id, url, signing_secret FROM workspace_webhooks WHERE id = $1 AND workspace_id = $2`,
      [webhookId, workspaceId]
    );

    if (hookRes.rows.length === 0) {
      throw new Error('NOT_FOUND: Webhook configuration not found in this workspace.');
    }

    const hook = hookRes.rows[0];
    const dummyAlertId = crypto.randomUUID();
    const deliveryId = `test_${crypto.randomUUID()}`;

    const testPayload: WebhookAlertPayload = {
      event_type: 'security_alert.test',
      timestamp: new Date().toISOString(),
      delivery_id: deliveryId,
      workspace_id: workspaceId,
      alert: {
        id: dummyAlertId,
        rule_id: 'test_rule',
        rule_name: 'test_ping_rule',
        severity: 'info',
        title: 'NomaanOS Sentinel Webhook Test Event',
        summary: 'Verification ping to test recipient HMAC signing and endpoint connectivity.',
        reason: 'User triggered test delivery from console.',
        status: 'open',
        first_event_at: new Date().toISOString(),
        last_event_at: new Date().toISOString(),
        event_count: 1,
        metadata: { ping: true },
      },
    };

    return this.deliverPayload(hook, null, testPayload, deliveryId, 1);
  }

  /**
   * Manually retries a failed or blocked delivery attempt.
   */
  public async retryDelivery(
    deliveryId: string,
    webhookId: string,
    workspaceId: string
  ): Promise<WebhookDeliveryRecord> {
    const deliveryRes = await pool.query(
      `SELECT d.*, h.url, h.signing_secret 
       FROM webhook_deliveries d
       JOIN workspace_webhooks h ON d.webhook_id = h.id
       WHERE d.id = $1 AND d.webhook_id = $2 AND d.workspace_id = $3`,
      [deliveryId, webhookId, workspaceId]
    );

    if (deliveryRes.rows.length === 0) {
      throw new Error('NOT_FOUND: Delivery record or webhook not found in this workspace.');
    }

    const row = deliveryRes.rows[0];
    const hook = {
      id: row.webhook_id,
      workspace_id: row.workspace_id,
      url: row.url,
      signing_secret: row.signing_secret,
    };

    const nextAttempt = (row.attempt_count || 1) + 1;
    return this.deliverPayload(hook, row.alert_id, row.payload, row.event_id, nextAttempt);
  }

  private mapDeliveryRow(r: any): WebhookDeliveryRecord {
    return {
      id: r.id,
      webhookId: r.webhook_id,
      workspaceId: r.workspace_id,
      eventId: r.event_id,
      alertId: r.alert_id,
      status: r.status,
      httpStatusCode: r.http_status_code,
      attemptCount: r.attempt_count,
      maxAttempts: r.max_attempts,
      nextRetryAt: r.next_retry_at,
      lastAttemptAt: r.last_attempt_at,
      deliveredAt: r.delivered_at,
      errorMessage: r.error_message,
      responseBodySnippet: r.response_body_snippet,
      createdAt: r.created_at,
    };
  }
}

export const webhookDispatcher = new WebhookDispatcher();
