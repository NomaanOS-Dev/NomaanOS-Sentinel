// apps/api/src/routes/billing.ts
// Billing, Subscriptions, and Razorpay Checkout / Webhook Router

import { Router, Request, Response, NextFunction } from 'express';
import { authenticate, requireVerified } from '../middleware/auth.js';
import { pool } from '../database/pool.js';
import { getAllPlans, getPlanDefinition, isValidPlan, PlanId } from '../config/plans.js';
import { billingService, QuotaExceededError } from '../services/billing-service.js';
import { razorpayService } from '../services/razorpay-service.js';
import { logger } from '../config/logger.js';

export const billingRouter = Router();

// Helper to check authorization for billing operations
async function checkBillingAuthorization(
  userId: string,
  targetType: 'workspace' | 'organization',
  targetId: string,
  minRole: 'owner' | 'admin' | 'viewer' = 'admin'
): Promise<{ authorized: boolean; role?: string }> {
  if (targetType === 'workspace') {
    const memRes = await pool.query(
      `SELECT role FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2`,
      [targetId, userId]
    );
    if (memRes.rows.length === 0) {
      // Also check if user is admin/owner of parent organization
      const wsRes = await pool.query(`SELECT organization_id FROM workspaces WHERE id = $1`, [targetId]);
      if (wsRes.rows[0]?.organization_id) {
        const orgMemRes = await pool.query(
          `SELECT role FROM organization_memberships WHERE organization_id = $1 AND user_id = $2`,
          [wsRes.rows[0].organization_id, userId]
        );
        if (orgMemRes.rows.length > 0) {
          const orgRole = orgMemRes.rows[0].role;
          if (minRole === 'viewer') return { authorized: true, role: orgRole };
          if (minRole === 'admin' && (orgRole === 'admin' || orgRole === 'owner')) return { authorized: true, role: orgRole };
          if (minRole === 'owner' && orgRole === 'owner') return { authorized: true, role: orgRole };
        }
      }
      return { authorized: false };
    }
    const role = memRes.rows[0].role;
    if (minRole === 'viewer') return { authorized: true, role };
    if (minRole === 'admin' && (role === 'admin' || role === 'owner')) return { authorized: true, role };
    if (minRole === 'owner' && role === 'owner') return { authorized: true, role };
    return { authorized: false, role };
  }

  // Organization authorization
  const orgMemRes = await pool.query(
    `SELECT role FROM organization_memberships WHERE organization_id = $1 AND user_id = $2`,
    [targetId, userId]
  );
  if (orgMemRes.rows.length === 0) return { authorized: false };
  const role = orgMemRes.rows[0].role;
  if (minRole === 'viewer') return { authorized: true, role };
  if (minRole === 'admin' && (role === 'admin' || role === 'owner')) return { authorized: true, role };
  if (minRole === 'owner' && role === 'owner') return { authorized: true, role };
  return { authorized: false, role };
}

// 1. List Available Plans
billingRouter.get('/plans', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    currency: 'INR',
    plans: getAllPlans(),
    razorpayConfigured: razorpayService.isConfigured(),
    isTestMode: razorpayService.isTestMode(),
    keyId: razorpayService.getKeyId(),
  });
});

// 2. Get Current Subscription, Effective Plan, and Consumption Quotas
billingRouter.get('/subscriptions', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { target_type, target_id } = req.query;

    if (!target_type || !target_id || (target_type !== 'workspace' && target_type !== 'organization')) {
      res.status(400).json({
        error: 'Validation Error',
        message: 'Query parameters target_type (workspace|organization) and target_id are required.',
      });
      return;
    }

    const { authorized, role } = await checkBillingAuthorization(
      req.user!.id,
      target_type as 'workspace' | 'organization',
      String(target_id),
      'viewer'
    );

    if (!authorized) {
      res.status(403).json({
        error: 'Forbidden',
        message: 'You do not have permission to view billing details for this resource.',
      });
      return;
    }

    const subscription = await billingService.getSubscription(target_type as 'workspace' | 'organization', String(target_id));
    const effectivePlan = await billingService.getEffectivePlan(target_type as 'workspace' | 'organization', String(target_id));
    const usage = await billingService.getCurrentUsage(target_type as 'workspace' | 'organization', String(target_id));
    const payments = await billingService.getPaymentsForTarget(target_type as 'workspace' | 'organization', String(target_id));

    res.status(200).json({
      status: 'ok',
      subscription,
      plan: effectivePlan,
      usage,
      payments,
      myRole: role,
      razorpayConfigured: razorpayService.isConfigured(),
      isTestMode: razorpayService.isTestMode(),
      keyId: razorpayService.getKeyId(),
    });
  } catch (err) {
    next(err);
  }
});

// 3. Initiate Checkout Order for Subscription Upgrade
billingRouter.post('/subscriptions', authenticate, requireVerified, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { target_type, target_id, plan_id } = req.body;

    if (!target_type || !target_id || !plan_id) {
      res.status(400).json({
        error: 'Validation Error',
        message: 'Fields target_type, target_id, and plan_id are required.',
      });
      return;
    }

    if (!isValidPlan(plan_id)) {
      res.status(400).json({
        error: 'Validation Error',
        message: `Invalid plan_id '${plan_id}'. Must be one of: free, starter, pro, msp.`,
      });
      return;
    }

    const { authorized } = await checkBillingAuthorization(
      req.user!.id,
      target_type as 'workspace' | 'organization',
      String(target_id),
      'admin'
    );

    if (!authorized) {
      res.status(403).json({
        error: 'Forbidden',
        message: 'Only workspace/organization administrators or owners can create or modify subscriptions.',
      });
      return;
    }

    // Free plan does not need payment checkout order
    if (plan_id === 'free') {
      const sub = await billingService.activateSubscription({
        targetType: target_type,
        targetId: target_id,
        planId: 'free',
      });
      res.status(200).json({ status: 'ok', subscription: sub });
      return;
    }

    // Create Razorpay Order
    const order = await razorpayService.createSubscriptionOrder({
      planId: plan_id as PlanId,
      targetType: target_type,
      targetId: String(target_id),
      customerEmail: req.user!.email,
      customerName: req.user!.fullName || 'Subscriber',
    });

    res.status(201).json({
      status: 'created',
      order,
    });
  } catch (err) {
    next(err);
  }
});

// 4. Verify Razorpay Payment Signature and Activate Entitlements
billingRouter.post('/subscriptions/verify', authenticate, requireVerified, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { target_type, target_id, plan_id, order_id, payment_id, signature } = req.body;

    if (!target_type || !target_id || !plan_id || !order_id || !payment_id || !signature) {
      res.status(400).json({
        error: 'Validation Error',
        message: 'Required fields: target_type, target_id, plan_id, order_id, payment_id, signature.',
      });
      return;
    }

    const { authorized } = await checkBillingAuthorization(
      req.user!.id,
      target_type as 'workspace' | 'organization',
      String(target_id),
      'admin'
    );

    if (!authorized) {
      res.status(403).json({
        error: 'Forbidden',
        message: 'You do not have permission to verify billing payments for this resource.',
      });
      return;
    }

    // Validate Signature Cryptographically
    const isValid = razorpayService.verifyPaymentSignature({
      orderId: String(order_id),
      paymentId: String(payment_id),
      signature: String(signature),
    });

    if (!isValid) {
      logger.warn({ userId: req.user!.id, orderId: order_id, paymentId: payment_id }, 'Checkout payment signature mismatch');
      res.status(400).json({
        error: 'INVALID_SIGNATURE',
        message: 'Razorpay checkout signature verification failed. Entitlements were not granted.',
      });
      return;
    }

    // Activate subscription in database
    const subscription = await billingService.activateSubscription({
      targetType: target_type,
      targetId: String(target_id),
      planId: plan_id as PlanId,
      providerPaymentId: String(payment_id),
      providerOrderId: String(order_id),
    });

    res.status(200).json({
      status: 'ok',
      message: 'Payment verified and plan entitlements activated successfully.',
      subscription,
    });
  } catch (err) {
    next(err);
  }
});

// 5. Cancel Subscription
billingRouter.post('/subscriptions/cancel', authenticate, requireVerified, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { target_type, target_id, cancel_at_period_end = true } = req.body;

    if (!target_type || !target_id) {
      res.status(400).json({
        error: 'Validation Error',
        message: 'Fields target_type and target_id are required.',
      });
      return;
    }

    const { authorized } = await checkBillingAuthorization(
      req.user!.id,
      target_type as 'workspace' | 'organization',
      String(target_id),
      'owner'
    );

    if (!authorized) {
      res.status(403).json({
        error: 'Forbidden',
        message: 'Only the resource owner can cancel a subscription.',
      });
      return;
    }

    const updated = await billingService.cancelSubscription(
      target_type,
      String(target_id),
      Boolean(cancel_at_period_end)
    );

    res.status(200).json({
      status: 'ok',
      message: cancel_at_period_end
        ? 'Subscription will be canceled at the end of the current billing cycle.'
        : 'Subscription canceled immediately.',
      subscription: updated,
    });
  } catch (err) {
    next(err);
  }
});

// 6. Razorpay Webhook Endpoint (Receives raw body and verifies HMAC signature)
billingRouter.post('/webhooks/razorpay', async (req: Request, res: Response) => {
  const signature = (req.headers['x-razorpay-signature'] as string) || '';
  if (!signature) {
    res.status(400).json({ error: 'Missing Signature', message: 'Missing X-Razorpay-Signature header' });
    return;
  }

  // Use rawBody buffer captured in Express middleware
  const rawBody = (req as any).rawBody || JSON.stringify(req.body);

  try {
    const result = await billingService.processRazorpayWebhook(rawBody, signature, req.body);
    res.status(200).json({ status: 'ok', result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('INVALID_SIGNATURE')) {
      res.status(400).json({ error: 'Invalid Signature', message });
      return;
    }
    logger.error({ err }, 'Razorpay webhook processing error');
    res.status(500).json({ error: 'Webhook Processing Error', message });
  }
});

