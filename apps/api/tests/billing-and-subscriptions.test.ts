// apps/api/tests/billing-and-subscriptions.test.ts
// Automated Tests for Subscriptions, Quota Enforcement, and Razorpay Billing Integration

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/pool.js';
import { config } from '../src/config/env.js';
import { razorpayService } from '../src/services/razorpay-service.js';
import { billingService } from '../src/services/billing-service.js';
import { PLANS, getPlanDefinition } from '../src/config/plans.js';
import { setAiProvider, MockAiProvider } from '../src/services/ai-provider.js';

describe('Billing, Subscriptions, Quotas, and Razorpay Integration', () => {
  const app = createApp();

  beforeEach(() => {
    setAiProvider(new MockAiProvider({ mode: 'success', delayMs: 1 }));
  });

  afterEach(() => {
    setAiProvider(null);
  });

  const makeUser = async (label: string) => {
    const email = `billing_${label}_${crypto.randomBytes(4).toString('hex')}@example.com`;
    const password = 'Password123!';
    const regRes = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email,
        password,
        fullName: `Billing User ${label}`,
        workspaceName: `Billing Workspace ${label}`,
      });

    const cookieHeader = regRes.headers['set-cookie'] as unknown as string[];
    const sessionCookie = cookieHeader
      .find((c: string) => c.startsWith(`${config.auth.sessionCookieName}=`))!
      .split(';')[0];

    await pool.query('UPDATE users SET is_verified = TRUE WHERE id = $1', [regRes.body.user.id]);

    return {
      userId: regRes.body.user.id as string,
      email,
      workspaceId: regRes.body.workspace.id as string,
      sessionCookie,
    };
  };

  it('1. should list available plans with explicit limits and pricing', async () => {
    const res = await request(app).get('/api/v1/billing/plans');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.plans.length).toBe(4);

    const planIds = res.body.plans.map((p: any) => p.id);
    expect(planIds).toContain('free');
    expect(planIds).toContain('starter');
    expect(planIds).toContain('pro');
    expect(planIds).toContain('msp');

    const freePlan = res.body.plans.find((p: any) => p.id === 'free');
    expect(freePlan.limits.maxIntegrationsPerWorkspace).toBe(1);
    expect(freePlan.limits.maxClientWorkspaces).toBe(0);
    expect(freePlan.features.canUseAiInvestigations).toBe(false);

    const proPlan = res.body.plans.find((p: any) => p.id === 'pro');
    expect(proPlan.limits.maxIntegrationsPerWorkspace).toBe(25);
    expect(proPlan.features.canUseAiInvestigations).toBe(true);
  });

  it('2. should enforce quota on registered integrations for Free tier and permit expansion after upgrade', async () => {
    const owner = await makeUser('quota_int');

    // Workspace starts on Free tier (limit: 1 integration)
    const firstIntRes = await request(app)
      .post(`/api/v1/workspaces/${owner.workspaceId}/integrations`)
      .set('Cookie', owner.sessionCookie)
      .send({ name: 'First Host Agent' });

    expect(firstIntRes.status).toBe(201);

    // Attempting to register a SECOND integration on Free tier MUST fail with 402 QUOTA_EXCEEDED
    const secondIntFail = await request(app)
      .post(`/api/v1/workspaces/${owner.workspaceId}/integrations`)
      .set('Cookie', owner.sessionCookie)
      .send({ name: 'Second Host Agent (Over Limit)' });

    expect(secondIntFail.status).toBe(402);
    expect(secondIntFail.body.error).toBe('QUOTA_EXCEEDED');
    expect(secondIntFail.body.quotaType).toBe('integrations');
    expect(secondIntFail.body.limit).toBe(1);
    expect(secondIntFail.body.currentUsage).toBe(1);

    // Upgrade workspace to Starter plan (limit: 5 integrations)
    await billingService.activateSubscription({
      targetType: 'workspace',
      targetId: owner.workspaceId,
      planId: 'starter',
      providerPaymentId: 'pay_test_upgrade',
    });

    // Now registering the second integration MUST succeed
    const secondIntSuccess = await request(app)
      .post(`/api/v1/workspaces/${owner.workspaceId}/integrations`)
      .set('Cookie', owner.sessionCookie)
      .send({ name: 'Second Host Agent (Post Upgrade)' });

    expect(secondIntSuccess.status).toBe(201);
  });

  it('3. should enforce quota on client workspaces for MSP organizations', async () => {
    const owner = await makeUser('quota_org');

    const orgRes = await request(app)
      .post('/api/v1/organizations')
      .set('Cookie', owner.sessionCookie)
      .send({ name: 'Restricted MSP SOC' });
    const orgId = orgRes.body.organization.id;

    // Explicitly set organization subscription to Starter plan (limit: 1 client workspace)
    await billingService.activateSubscription({
      targetType: 'organization',
      targetId: orgId,
      planId: 'starter',
    });

    // First client workspace succeeds
    const c1 = await request(app)
      .post(`/api/v1/organizations/${orgId}/clients`)
      .set('Cookie', owner.sessionCookie)
      .send({ name: 'First Client' });
    expect(c1.status).toBe(201);

    // Second client workspace exceeds Starter quota of 1 -> fails with 402
    const c2Fail = await request(app)
      .post(`/api/v1/organizations/${orgId}/clients`)
      .set('Cookie', owner.sessionCookie)
      .send({ name: 'Second Client (Quota Exceeded)' });

    expect(c2Fail.status).toBe(402);
    expect(c2Fail.body.error).toBe('QUOTA_EXCEEDED');
    expect(c2Fail.body.quotaType).toBe('client_workspaces');
    expect(c2Fail.body.limit).toBe(1);

    // Upgrade organization to MSP plan (limit: 50 client workspaces)
    await billingService.activateSubscription({
      targetType: 'organization',
      targetId: orgId,
      planId: 'msp',
    });

    // Second client workspace now succeeds
    const c2Success = await request(app)
      .post(`/api/v1/organizations/${orgId}/clients`)
      .set('Cookie', owner.sessionCookie)
      .send({ name: 'Second Client (After MSP Upgrade)' });
    expect(c2Success.status).toBe(201);
  });

  it('4. should enforce feature gating on AI investigations based on plan entitlements', async () => {
    const owner = await makeUser('feature_ai');

    // Create a case
    const caseRes = await request(app)
      .post(`/api/v1/workspaces/${owner.workspaceId}/cases`)
      .set('Cookie', owner.sessionCookie)
      .send({ title: 'Suspicious Activity', description: 'Investigate potential breach' });
    const caseId = caseRes.body.case.id;

    // Free plan does not include AI investigations -> fails with 402 QUOTA_EXCEEDED
    const aiFail = await request(app)
      .post(`/api/v1/workspaces/${owner.workspaceId}/cases/${caseId}/ai-investigate`)
      .set('Cookie', owner.sessionCookie)
      .send({});

    expect(aiFail.status).toBe(402);
    expect(aiFail.body.error).toBe('QUOTA_EXCEEDED');
    expect(aiFail.body.quotaType).toBe('feature_ai');

    // Upgrade to Pro plan (includes AI investigations)
    await billingService.activateSubscription({
      targetType: 'workspace',
      targetId: owner.workspaceId,
      planId: 'pro',
    });

    // Now AI investigation is allowed through quota gate
    const aiRes = await request(app)
      .post(`/api/v1/workspaces/${owner.workspaceId}/cases/${caseId}/ai-investigate`)
      .set('Cookie', owner.sessionCookie)
      .send({});

    // Succeeded or mock response (status 200)
    expect(aiRes.status).toBe(200);
    expect(aiRes.body.status).toBe('ok');
  });

  it('5. should enforce tenant isolation on billing data access', async () => {
    const owner = await makeUser('iso_owner');
    const outsider = await makeUser('iso_outsider');

    // Outsider cannot access owner's workspace subscription
    const failWs = await request(app)
      .get(`/api/v1/billing/subscriptions?target_type=workspace&target_id=${owner.workspaceId}`)
      .set('Cookie', outsider.sessionCookie);
    expect(failWs.status).toBe(403);

    // Outsider cannot upgrade owner's workspace
    const failUpgrade = await request(app)
      .post('/api/v1/billing/subscriptions')
      .set('Cookie', outsider.sessionCookie)
      .send({
        target_type: 'workspace',
        target_id: owner.workspaceId,
        plan_id: 'pro',
      });
    expect(failUpgrade.status).toBe(403);
  });

  it('6. should verify Razorpay checkout signatures correctly and reject forged signatures', async () => {
    const owner = await makeUser('razor_verify');
    const secret = 'test_razorpay_secret_12345';
    // Temporarily configure test secret
    config.razorpay.keySecret = secret;

    const orderId = 'order_valid_123456';
    const paymentId = 'pay_valid_987654';

    // 1. Valid Signature
    const validSig = crypto
      .createHmac('sha256', secret)
      .update(`${orderId}|${paymentId}`)
      .digest('hex');

    const verifySuccess = await request(app)
      .post('/api/v1/billing/subscriptions/verify')
      .set('Cookie', owner.sessionCookie)
      .send({
        target_type: 'workspace',
        target_id: owner.workspaceId,
        plan_id: 'starter',
        order_id: orderId,
        payment_id: paymentId,
        signature: validSig,
      });

    expect(verifySuccess.status).toBe(200);
    expect(verifySuccess.body.subscription.planId).toBe('starter');
    expect(verifySuccess.body.subscription.status).toBe('active');

    // 2. Forged / Tampered Signature
    const verifyTampered = await request(app)
      .post('/api/v1/billing/subscriptions/verify')
      .set('Cookie', owner.sessionCookie)
      .send({
        target_type: 'workspace',
        target_id: owner.workspaceId,
        plan_id: 'pro',
        order_id: orderId,
        payment_id: paymentId,
        signature: 'forged_fake_signature_abc123',
      });

    expect(verifyTampered.status).toBe(400);
    expect(verifyTampered.body.error).toBe('INVALID_SIGNATURE');
  });

  it('7. should process Razorpay webhooks with signature verification and idempotency', async () => {
    const owner = await makeUser('razor_webhook');
    const webhookSecret = 'test_webhook_signing_secret_999';
    config.razorpay.webhookSecret = webhookSecret;

    const eventId = `evt_test_${crypto.randomBytes(6).toString('hex')}`;
    const payload = {
      event_id: eventId,
      event: 'order.paid',
      payload: {
        payment: {
          entity: {
            id: 'pay_webhook_123',
            order_id: 'order_webhook_456',
            amount: 1999900,
            status: 'captured',
            notes: {
              planId: 'pro',
              targetType: 'workspace',
              targetId: owner.workspaceId,
            },
          },
        },
      },
    };

    const rawBody = JSON.stringify(payload);
    const validSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(Buffer.from(rawBody, 'utf-8'))
      .digest('hex');

    // 1. Rejected if signature is invalid
    const invalidSigRes = await request(app)
      .post('/api/v1/billing/webhooks/razorpay')
      .set('Content-Type', 'application/json')
      .set('X-Razorpay-Signature', 'invalid_signature_hex')
      .send(rawBody);

    expect(invalidSigRes.status).toBe(400);
    expect(invalidSigRes.body.error).toBe('Invalid Signature');

    // 2. Successful on valid signature
    const validWebhookRes = await request(app)
      .post('/api/v1/billing/webhooks/razorpay')
      .set('Content-Type', 'application/json')
      .set('X-Razorpay-Signature', validSignature)
      .send(rawBody);

    expect(validWebhookRes.status).toBe(200);
    expect(validWebhookRes.body.status).toBe('ok');
    expect(validWebhookRes.body.result.status).toBe('processed');

    // Verify workspace was upgraded to Pro
    const sub = await billingService.getSubscription('workspace', owner.workspaceId);
    expect(sub.planId).toBe('pro');
    expect(sub.status).toBe('active');

    // 3. Duplicate event delivery is handled idempotently
    const duplicateWebhookRes = await request(app)
      .post('/api/v1/billing/webhooks/razorpay')
      .set('Content-Type', 'application/json')
      .set('X-Razorpay-Signature', validSignature)
      .send(rawBody);

    expect(duplicateWebhookRes.status).toBe(200);
    expect(duplicateWebhookRes.body.result.duplicate).toBe(true);
  });

  it('8. should handle subscription cancellation requests gracefully', async () => {
    const owner = await makeUser('cancel_sub');

    // Activate Pro subscription
    await billingService.activateSubscription({
      targetType: 'workspace',
      targetId: owner.workspaceId,
      planId: 'pro',
    });

    // Cancel at period end
    const cancelRes = await request(app)
      .post('/api/v1/billing/subscriptions/cancel')
      .set('Cookie', owner.sessionCookie)
      .send({
        target_type: 'workspace',
        target_id: owner.workspaceId,
        cancel_at_period_end: true,
      });

    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.subscription.cancelAtPeriodEnd).toBe(true);
    expect(cancelRes.body.subscription.status).toBe('active'); // Still active until period end

    // Immediate cancellation
    const cancelImmediate = await request(app)
      .post('/api/v1/billing/subscriptions/cancel')
      .set('Cookie', owner.sessionCookie)
      .send({
        target_type: 'workspace',
        target_id: owner.workspaceId,
        cancel_at_period_end: false,
      });

    expect(cancelImmediate.status).toBe(200);
    expect(cancelImmediate.body.subscription.status).toBe('canceled');

    // Effective plan falls back to free
    const effectivePlan = await billingService.getEffectivePlan('workspace', owner.workspaceId);
    expect(effectivePlan.id).toBe('free');
  });
});
