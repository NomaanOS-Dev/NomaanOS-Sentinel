// apps/api/src/services/billing-service.ts
// Centralized server-side subscription management, quota enforcement, and billing lifecycle

import crypto from 'crypto';
import { pool } from '../database/pool.js';
import { logger } from '../config/logger.js';
import { getPlanDefinition, PlanDefinition, PlanId, PLANS } from '../config/plans.js';
import { razorpayService } from './razorpay-service.js';

export class QuotaExceededError extends Error {
  public readonly code = 'QUOTA_EXCEEDED';
  public readonly statusCode = 402; // Payment Required
  public readonly quotaType: string;
  public readonly limit: number;
  public readonly currentUsage: number;
  public readonly planId: string;
  public readonly upgradeRequired: string;

  constructor(params: {
    quotaType: string;
    limit: number;
    currentUsage: number;
    planId: string;
    message: string;
    upgradeRequired?: string;
  }) {
    super(params.message);
    this.name = 'QuotaExceededError';
    this.quotaType = params.quotaType;
    this.limit = params.limit;
    this.currentUsage = params.currentUsage;
    this.planId = params.planId;
    this.upgradeRequired = params.upgradeRequired || 'pro';
  }
}

export interface SubscriptionRecord {
  id: string;
  targetType: 'workspace' | 'organization';
  targetId: string;
  planId: PlanId;
  status: 'trialing' | 'active' | 'past_due' | 'canceled' | 'unpaid' | 'incomplete' | 'paused';
  billingCycle: 'monthly' | 'annual';
  provider: string;
  providerCustomerId: string | null;
  providerSubscriptionId: string | null;
  providerPlanId: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TargetUsage {
  clientWorkspaces: number;
  integrations: number;
  monthlyEvents: number;
}

export class BillingService {
  /**
   * Retrieves the subscription record for a workspace or organization.
   * If none exists in DB, returns a safe default Free subscription representation.
   */
  public async getSubscription(
    targetType: 'workspace' | 'organization',
    targetId: string
  ): Promise<SubscriptionRecord> {
    const res = await pool.query(
      `SELECT 
        id, target_type, target_id, plan_id, status, billing_cycle,
        provider, provider_customer_id, provider_subscription_id, provider_plan_id,
        current_period_start, current_period_end, cancel_at_period_end, canceled_at,
        created_at, updated_at
       FROM subscriptions
       WHERE target_type = $1 AND target_id = $2`,
      [targetType, targetId]
    );

    if (res.rows.length > 0) {
      const r = res.rows[0];
      return {
        id: r.id,
        targetType: r.target_type,
        targetId: r.target_id,
        planId: r.plan_id as PlanId,
        status: r.status,
        billingCycle: r.billing_cycle,
        provider: r.provider,
        providerCustomerId: r.provider_customer_id,
        providerSubscriptionId: r.provider_subscription_id,
        providerPlanId: r.provider_plan_id,
        currentPeriodStart: r.current_period_start,
        currentPeriodEnd: r.current_period_end,
        cancelAtPeriodEnd: r.cancel_at_period_end,
        canceledAt: r.canceled_at,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      };
    }

    // Default Free Tier
    return {
      id: `sub_free_${targetId.substring(0, 8)}`,
      targetType,
      targetId,
      planId: 'free',
      status: 'active',
      billingCycle: 'monthly',
      provider: 'razorpay',
      providerCustomerId: null,
      providerSubscriptionId: null,
      providerPlanId: null,
      currentPeriodStart: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      canceledAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * Resolves the effective plan definition.
   * If a workspace belongs to an organization, checks if the organization holds an MSP subscription.
   */
  public async getEffectivePlan(
    targetType: 'workspace' | 'organization',
    targetId: string
  ): Promise<PlanDefinition> {
    if (targetType === 'workspace') {
      // Check if this workspace is managed under an MSP organization
      const wsRes = await pool.query(
        `SELECT organization_id FROM workspaces WHERE id = $1`,
        [targetId]
      );
      if (wsRes.rows.length > 0 && wsRes.rows[0].organization_id) {
        const orgSub = await this.getSubscription('organization', wsRes.rows[0].organization_id);
        if (orgSub.status === 'active' || orgSub.status === 'trialing') {
          return getPlanDefinition(orgSub.planId);
        }
      }
    }

    const sub = await this.getSubscription(targetType, targetId);
    // If subscription is canceled, unpaid, or past_due beyond grace, fallback to free plan limits
    if (sub.status !== 'active' && sub.status !== 'trialing') {
      return getPlanDefinition('free');
    }

    return getPlanDefinition(sub.planId);
  }

  /**
   * Computes current consumption metrics for a target.
   */
  public async getCurrentUsage(
    targetType: 'workspace' | 'organization',
    targetId: string
  ): Promise<TargetUsage> {
    if (targetType === 'organization') {
      const clientWorkspacesRes = await pool.query(
        `SELECT COUNT(*)::int AS count FROM workspaces WHERE organization_id = $1`,
        [targetId]
      );

      const integrationsRes = await pool.query(
        `SELECT COUNT(i.id)::int AS count 
         FROM integrations i
         JOIN workspaces w ON i.workspace_id = w.id
         WHERE w.organization_id = $1 AND i.status != 'revoked'`,
        [targetId]
      );

      const monthlyEventsRes = await pool.query(
        `SELECT COUNT(e.id)::int AS count
         FROM security_events e
         JOIN workspaces w ON e.tenant_id = w.id
         WHERE w.organization_id = $1
           AND e.occurred_at >= date_trunc('month', NOW())`,
        [targetId]
      );

      return {
        clientWorkspaces: clientWorkspacesRes.rows[0]?.count || 0,
        integrations: integrationsRes.rows[0]?.count || 0,
        monthlyEvents: monthlyEventsRes.rows[0]?.count || 0,
      };
    }

    // Standalone workspace usage
    const integrationsRes = await pool.query(
      `SELECT COUNT(*)::int AS count FROM integrations WHERE workspace_id = $1 AND status != 'revoked'`,
      [targetId]
    );

    const monthlyEventsRes = await pool.query(
      `SELECT COUNT(*)::int AS count 
       FROM security_events 
       WHERE tenant_id = $1 AND occurred_at >= date_trunc('month', NOW())`,
      [targetId]
    );

    return {
      clientWorkspaces: 0,
      integrations: integrationsRes.rows[0]?.count || 0,
      monthlyEvents: monthlyEventsRes.rows[0]?.count || 0,
    };
  }

  /**
   * Retrieves payment transaction history for a subscription.
   */
  public async getPaymentHistory(subscriptionId: string): Promise<any[]> {
    const res = await pool.query(
      `SELECT id, subscription_id, provider_payment_id, provider_order_id, provider_invoice_id,
              amount_paise, currency, status, error_code, error_description, created_at
       FROM billing_payments
       WHERE subscription_id = $1
       ORDER BY created_at DESC
       LIMIT 50`,
      [subscriptionId]
    );
    return res.rows.map((r) => ({
      id: r.id,
      subscriptionId: r.subscription_id,
      providerPaymentId: r.provider_payment_id,
      providerOrderId: r.provider_order_id,
      providerInvoiceId: r.provider_invoice_id,
      amountPaise: Number(r.amount_paise),
      currency: r.currency,
      status: r.status,
      errorCode: r.error_code,
      errorDescription: r.error_description,
      createdAt: r.created_at,
    }));
  }

  /**
   * Retrieves payments for a target workspace or organization.
   */
  public async getPaymentsForTarget(
    targetType: 'workspace' | 'organization',
    targetId: string
  ): Promise<any[]> {
    const subRes = await pool.query(
      `SELECT id FROM subscriptions WHERE target_type = $1 AND target_id = $2`,
      [targetType, targetId]
    );
    if (subRes.rows.length === 0) return [];
    return this.getPaymentHistory(subRes.rows[0].id);
  }

  /**
   * Enforces backend server-side quotas atomically. Throws QuotaExceededError if limit is reached.
   */
  public async assertQuota(
    targetType: 'workspace' | 'organization',
    targetId: string,
    quotaType:
      | 'client_workspaces'
      | 'integrations'
      | 'monthly_events'
      | 'feature_ai'
      | 'feature_webhooks'
      | 'feature_msp_console',
    increment = 1
  ): Promise<void> {
    const plan = await this.getEffectivePlan(targetType, targetId);
    const usage = await this.getCurrentUsage(targetType, targetId);

    switch (quotaType) {
      case 'client_workspaces': {
        const current = usage.clientWorkspaces;
        const max = plan.limits.maxClientWorkspaces;
        if (current + increment > max) {
          throw new QuotaExceededError({
            quotaType: 'client_workspaces',
            limit: max,
            currentUsage: current,
            planId: plan.id,
            message: `Plan limit reached: The ${plan.name} plan allows up to ${max} client workspaces (currently using ${current}). Please upgrade to expand multi-client capacity.`,
            upgradeRequired: plan.id === 'starter' ? 'pro' : 'msp',
          });
        }
        break;
      }

      case 'integrations': {
        const current = usage.integrations;
        const max = plan.limits.maxIntegrationsPerWorkspace;
        if (current + increment > max) {
          throw new QuotaExceededError({
            quotaType: 'integrations',
            limit: max,
            currentUsage: current,
            planId: plan.id,
            message: `Integration limit reached: The ${plan.name} plan allows up to ${max} registered agent integrations per workspace (currently using ${current}). Please upgrade your plan to register additional host agents.`,
            upgradeRequired: plan.id === 'free' ? 'starter' : plan.id === 'starter' ? 'pro' : 'msp',
          });
        }
        break;
      }

      case 'monthly_events': {
        const current = usage.monthlyEvents;
        const max = plan.limits.maxMonthlyEventsPerWorkspace;
        if (current + increment > max) {
          throw new QuotaExceededError({
            quotaType: 'monthly_events',
            limit: max,
            currentUsage: current,
            planId: plan.id,
            message: `Monthly event quota exceeded: The ${plan.name} plan includes ${max.toLocaleString()} events per billing cycle (current usage: ${current.toLocaleString()}). Ingestion is throttled until the next billing cycle or upgrade.`,
            upgradeRequired: plan.id === 'free' ? 'starter' : plan.id === 'starter' ? 'pro' : 'msp',
          });
        }
        break;
      }

      case 'feature_ai': {
        if (!plan.features.canUseAiInvestigations) {
          throw new QuotaExceededError({
            quotaType: 'feature_ai',
            limit: 0,
            currentUsage: 0,
            planId: plan.id,
            message: `AI Investigation Assistant is not available on the ${plan.name} plan. Please upgrade to Pro or MSP to enable automated threat investigations.`,
            upgradeRequired: 'pro',
          });
        }
        break;
      }

      case 'feature_webhooks': {
        if (!plan.features.canUseOutboundWebhooks) {
          throw new QuotaExceededError({
            quotaType: 'feature_webhooks',
            limit: 0,
            currentUsage: 0,
            planId: plan.id,
            message: `Outbound alert webhooks are not available on the ${plan.name} plan. Please upgrade to Starter or higher to forward alerts to SIEM, SOAR, or messaging platforms.`,
            upgradeRequired: 'starter',
          });
        }
        break;
      }

      case 'feature_msp_console': {
        if (!plan.features.canUseMspConsole) {
          throw new QuotaExceededError({
            quotaType: 'feature_msp_console',
            limit: 0,
            currentUsage: 0,
            planId: plan.id,
            message: `Centralized MSP multi-client management requires the Sentinel MSP Platform plan.`,
            upgradeRequired: 'msp',
          });
        }
        break;
      }
    }
  }

  /**
   * Activates or updates a subscription following verified checkout or webhook confirmation.
   */
  public async activateSubscription(params: {
    targetType: 'workspace' | 'organization';
    targetId: string;
    planId: PlanId;
    providerCustomerId?: string;
    providerSubscriptionId?: string;
    providerPaymentId?: string;
    providerOrderId?: string;
    amountPaise?: number;
    billingCycle?: 'monthly' | 'annual';
    currentPeriodStart?: Date;
    currentPeriodEnd?: Date;
  }): Promise<SubscriptionRecord> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const plan = getPlanDefinition(params.planId);
      const cycle = params.billingCycle || 'monthly';
      const periodStart = params.currentPeriodStart || new Date();
      const periodEnd =
        params.currentPeriodEnd ||
        new Date(periodStart.getTime() + (cycle === 'annual' ? 365 : 30) * 24 * 60 * 60 * 1000);

      const upsertSubQuery = `
        INSERT INTO subscriptions (
          target_type, target_id, plan_id, status, billing_cycle,
          provider, provider_customer_id, provider_subscription_id,
          current_period_start, current_period_end, cancel_at_period_end, updated_at
        ) VALUES (
          $1, $2, $3, 'active', $4,
          'razorpay', $5, $6,
          $7, $8, FALSE, NOW()
        )
        ON CONFLICT (target_type, target_id) DO UPDATE SET
          plan_id = EXCLUDED.plan_id,
          status = 'active',
          billing_cycle = EXCLUDED.billing_cycle,
          provider_customer_id = COALESCE(EXCLUDED.provider_customer_id, subscriptions.provider_customer_id),
          provider_subscription_id = COALESCE(EXCLUDED.provider_subscription_id, subscriptions.provider_subscription_id),
          current_period_start = EXCLUDED.current_period_start,
          current_period_end = EXCLUDED.current_period_end,
          cancel_at_period_end = FALSE,
          canceled_at = NULL,
          updated_at = NOW()
        RETURNING *;
      `;

      const subRes = await client.query(upsertSubQuery, [
        params.targetType,
        params.targetId,
        params.planId,
        cycle,
        params.providerCustomerId || null,
        params.providerSubscriptionId || null,
        periodStart,
        periodEnd,
      ]);

      const sub = subRes.rows[0];

      // Record payment transaction
      if (params.providerPaymentId || params.amountPaise) {
        await client.query(
          `INSERT INTO billing_payments (
            subscription_id, provider_payment_id, provider_order_id,
            amount_paise, currency, status, raw_payload
          ) VALUES ($1, $2, $3, $4, 'INR', 'captured', $5)`,
          [
            sub.id,
            params.providerPaymentId || null,
            params.providerOrderId || null,
            params.amountPaise || plan.pricing.amountPaise,
            JSON.stringify({ planId: params.planId, activatedAt: new Date().toISOString() }),
          ]
        );
      }

      await client.query('COMMIT');

      logger.info(
        { targetType: params.targetType, targetId: params.targetId, planId: params.planId },
        'Subscription activated successfully'
      );

      return {
        id: sub.id,
        targetType: sub.target_type,
        targetId: sub.target_id,
        planId: sub.plan_id,
        status: sub.status,
        billingCycle: sub.billing_cycle,
        provider: sub.provider,
        providerCustomerId: sub.provider_customer_id,
        providerSubscriptionId: sub.provider_subscription_id,
        providerPlanId: sub.provider_plan_id,
        currentPeriodStart: sub.current_period_start,
        currentPeriodEnd: sub.current_period_end,
        cancelAtPeriodEnd: sub.cancel_at_period_end,
        canceledAt: sub.canceled_at,
        createdAt: sub.created_at,
        updatedAt: sub.updated_at,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      logger.error({ err, targetType: params.targetType, targetId: params.targetId }, 'Failed to activate subscription');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Cancels a subscription either immediately or at period end.
   */
  public async cancelSubscription(
    targetType: 'workspace' | 'organization',
    targetId: string,
    cancelAtPeriodEnd = true
  ): Promise<SubscriptionRecord> {
    const sub = await this.getSubscription(targetType, targetId);
    if (sub.planId === 'free') {
      return sub;
    }

    if (sub.providerSubscriptionId) {
      try {
        await razorpayService.cancelSubscription(sub.providerSubscriptionId, cancelAtPeriodEnd);
      } catch (err) {
        logger.warn({ err, subId: sub.id }, 'Upstream Razorpay subscription cancellation failed or skipped');
      }
    }

    const query = cancelAtPeriodEnd
      ? `UPDATE subscriptions 
         SET cancel_at_period_end = TRUE, updated_at = NOW()
         WHERE target_type = $1 AND target_id = $2
         RETURNING *`
      : `UPDATE subscriptions 
         SET status = 'canceled', canceled_at = NOW(), updated_at = NOW()
         WHERE target_type = $1 AND target_id = $2
         RETURNING *`;

    const res = await pool.query(query, [targetType, targetId]);
    const updated = res.rows[0];

    logger.info(
      { targetType, targetId, cancelAtPeriodEnd },
      'Subscription cancellation updated'
    );

    return {
      id: updated.id,
      targetType: updated.target_type,
      targetId: updated.target_id,
      planId: updated.plan_id,
      status: updated.status,
      billingCycle: updated.billing_cycle,
      provider: updated.provider,
      providerCustomerId: updated.provider_customer_id,
      providerSubscriptionId: updated.provider_subscription_id,
      providerPlanId: updated.provider_plan_id,
      currentPeriodStart: updated.current_period_start,
      currentPeriodEnd: updated.current_period_end,
      cancelAtPeriodEnd: updated.cancel_at_period_end,
      canceledAt: updated.canceled_at,
      createdAt: updated.created_at,
      updatedAt: updated.updated_at,
    };
  }

  /**
   * Processes verified Razorpay webhooks idempotently using event_id tracking.
   */
  public async processRazorpayWebhook(
    rawBody: string | Buffer,
    signature: string,
    payload: any
  ): Promise<{ status: string; eventId: string; duplicate?: boolean }> {
    // 1. Verify cryptographic signature
    const isValid = razorpayService.verifyWebhookSignature(rawBody, signature);
    if (!isValid) {
      throw new Error('INVALID_SIGNATURE: Webhook signature verification failed.');
    }

    const eventId = String(payload.event_id || payload.id || `evt_${crypto.randomBytes(8).toString('hex')}`);
    const eventType = String(payload.event || 'unknown');

    // 2. Check for duplicate event (idempotency)
    const existing = await pool.query(
      `SELECT id, processed FROM billing_webhook_events WHERE event_id = $1`,
      [eventId]
    );

    if (existing.rows.length > 0) {
      logger.info({ eventId, eventType }, 'Idempotent duplicate webhook event ignored');
      return { status: 'duplicate', eventId, duplicate: true };
    }

    // 3. Record event in billing_webhook_events
    await pool.query(
      `INSERT INTO billing_webhook_events (provider, event_id, event_type, payload)
       VALUES ('razorpay', $1, $2, $3)`,
      [eventId, eventType, JSON.stringify(payload)]
    );

    // 4. Process supported event types
    try {
      if (eventType === 'order.paid' || eventType === 'payment.captured') {
        const paymentEntity = payload.payload?.payment?.entity || payload.payload?.order?.entity || {};
        const notes = paymentEntity.notes || {};
        const planId = notes.planId as PlanId;
        const targetType = notes.targetType as 'workspace' | 'organization';
        const targetId = notes.targetId as string;

        if (planId && targetType && targetId) {
          await this.activateSubscription({
            targetType,
            targetId,
            planId,
            providerPaymentId: paymentEntity.id,
            providerOrderId: paymentEntity.order_id,
            amountPaise: paymentEntity.amount,
          });
        }
      } else if (eventType === 'subscription.activated' || eventType === 'subscription.charged') {
        const subEntity = payload.payload?.subscription?.entity || {};
        const notes = subEntity.notes || {};
        const planId = (notes.planId || 'pro') as PlanId;
        const targetType = (notes.targetType || 'workspace') as 'workspace' | 'organization';
        const targetId = notes.targetId as string;

        if (targetId) {
          await this.activateSubscription({
            targetType,
            targetId,
            planId,
            providerSubscriptionId: subEntity.id,
            providerCustomerId: subEntity.customer_id,
            currentPeriodStart: subEntity.current_start ? new Date(subEntity.current_start * 1000) : undefined,
            currentPeriodEnd: subEntity.current_end ? new Date(subEntity.current_end * 1000) : undefined,
          });
        }
      } else if (eventType === 'subscription.cancelled' || eventType === 'subscription.halted') {
        const subEntity = payload.payload?.subscription?.entity || {};
        const providerSubId = subEntity.id;
        if (providerSubId) {
          await pool.query(
            `UPDATE subscriptions 
             SET status = 'canceled', canceled_at = NOW(), updated_at = NOW()
             WHERE provider_subscription_id = $1`,
            [providerSubId]
          );
        }
      } else if (eventType === 'payment.failed') {
        const paymentEntity = payload.payload?.payment?.entity || {};
        const notes = paymentEntity.notes || {};
        const targetId = notes.targetId;
        const targetType = notes.targetType;

        if (targetType && targetId) {
          await pool.query(
            `UPDATE subscriptions 
             SET status = 'past_due', updated_at = NOW()
             WHERE target_type = $1 AND target_id = $2`,
            [targetType, targetId]
          );
        }
      }

      // Mark event as processed
      await pool.query(
        `UPDATE billing_webhook_events 
         SET processed = TRUE, processed_at = NOW() 
         WHERE event_id = $1`,
        [eventId]
      );

      return { status: 'processed', eventId };
    } catch (processErr) {
      await pool.query(
        `UPDATE billing_webhook_events 
         SET processing_error = $1 
         WHERE event_id = $2`,
        [processErr instanceof Error ? processErr.message : String(processErr), eventId]
      );
      throw processErr;
    }
  }
}

export const billingService = new BillingService();
