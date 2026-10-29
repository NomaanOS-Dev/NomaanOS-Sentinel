// apps/api/src/services/razorpay-service.ts
// Secure server-side Razorpay payment and subscription lifecycle adapter

import crypto from 'crypto';
import Razorpay from 'razorpay';
import { config } from '../config/env.js';
import { logger } from '../config/logger.js';
import { getPlanDefinition, PlanId } from '../config/plans.js';

export interface VerifyPaymentSignatureParams {
  orderId: string;
  paymentId: string;
  signature: string;
}

export interface VerifySubscriptionSignatureParams {
  subscriptionId: string;
  paymentId: string;
  signature: string;
}

export interface CreateSubscriptionResult {
  id: string; // Razorpay subscription or order ID
  planId: PlanId;
  amountPaise: number;
  currency: string;
  keyId: string;
  status: string;
  shortUrl?: string;
  provider: 'razorpay';
}

export class RazorpayService {
  private instance: any = null;

  constructor() {
    this.initInstance();
  }

  private initInstance() {
    if (config.razorpay.keyId && config.razorpay.keySecret) {
      try {
        this.instance = new Razorpay({
          key_id: config.razorpay.keyId,
          key_secret: config.razorpay.keySecret,
        });
      } catch (err) {
        logger.warn({ err }, 'Failed to initialize Razorpay SDK instance');
      }
    }
  }

  public isConfigured(): boolean {
    return Boolean(config.razorpay.keyId && config.razorpay.keySecret);
  }

  public isTestMode(): boolean {
    return config.razorpay.isTestMode;
  }

  public getKeyId(): string {
    return config.razorpay.keyId || 'rzp_test_placeholder_key';
  }

  /**
   * Cryptographically verifies a Razorpay Checkout payment signature using HMAC-SHA256.
   * Format: HMAC_SHA256(order_id + "|" + payment_id, key_secret)
   */
  public verifyPaymentSignature(params: VerifyPaymentSignatureParams): boolean {
    const secret = config.razorpay.keySecret;
    if (!secret) {
      logger.warn('Razorpay key secret not configured; rejecting payment signature verification');
      return false;
    }

    try {
      const generated = crypto
        .createHmac('sha256', secret)
        .update(`${params.orderId}|${params.paymentId}`)
        .digest('hex');

      return crypto.timingSafeEqual(Buffer.from(generated), Buffer.from(params.signature));
    } catch (err) {
      logger.warn({ err }, 'Error during payment signature verification');
      return false;
    }
  }

  /**
   * Cryptographically verifies a Razorpay Checkout recurring subscription signature using HMAC-SHA256.
   * Format: HMAC_SHA256(payment_id + "|" + subscription_id, key_secret)
   */
  public verifySubscriptionSignature(params: VerifySubscriptionSignatureParams): boolean {
    const secret = config.razorpay.keySecret;
    if (!secret) {
      logger.warn('Razorpay key secret not configured; rejecting subscription signature verification');
      return false;
    }

    try {
      const generated = crypto
        .createHmac('sha256', secret)
        .update(`${params.paymentId}|${params.subscriptionId}`)
        .digest('hex');

      return crypto.timingSafeEqual(Buffer.from(generated), Buffer.from(params.signature));
    } catch (err) {
      logger.warn({ err }, 'Error during subscription signature verification');
      return false;
    }
  }

  /**
   * Cryptographically verifies an incoming Razorpay webhook signature against the raw body buffer.
   * Prevents webhook spoofing or tampering.
   */
  public verifyWebhookSignature(
    rawBody: string | Buffer,
    signature: string,
    secretOverride?: string
  ): boolean {
    const secret = secretOverride || config.razorpay.webhookSecret;
    if (!secret) {
      logger.warn('Razorpay webhook secret not configured; rejecting webhook signature verification');
      return false;
    }

    if (!signature) {
      return false;
    }

    try {
      const expectedSignature = crypto
        .createHmac('sha256', secret)
        .update(typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf-8') : rawBody)
        .digest('hex');

      const expectedBuf = Buffer.from(expectedSignature, 'utf-8');
      const actualBuf = Buffer.from(signature, 'utf-8');

      if (expectedBuf.length !== actualBuf.length) {
        return false;
      }

      return crypto.timingSafeEqual(expectedBuf, actualBuf);
    } catch (err) {
      logger.warn({ err }, 'Error during webhook signature verification');
      return false;
    }
  }

  /**
   * Initiates a subscription checkout order on Razorpay for a plan.
   * In sandbox mode when keys are placeholder, safely creates local deterministic order.
   */
  public async createSubscriptionOrder(params: {
    planId: PlanId;
    targetType: 'workspace' | 'organization';
    targetId: string;
    customerEmail: string;
    customerName: string;
  }): Promise<CreateSubscriptionResult> {
    const plan = getPlanDefinition(params.planId);
    if (plan.id === 'free') {
      throw new Error('Free plan does not require a payment provider checkout order.');
    }

    // If live or real test keys are configured and instance exists:
    if (this.instance && this.isConfigured() && !config.razorpay.keyId?.includes('placeholder')) {
      try {
        // Create standard Razorpay Order for initial billing period
        const order = await this.instance.orders.create({
          amount: plan.pricing.amountPaise,
          currency: plan.pricing.currency,
          receipt: `rcpt_${params.targetType.substring(0, 3)}_${params.targetId.substring(0, 8)}_${Date.now()}`,
          notes: {
            planId: plan.id,
            targetType: params.targetType,
            targetId: params.targetId,
            customerEmail: params.customerEmail,
          },
        });

        return {
          id: order.id,
          planId: plan.id,
          amountPaise: plan.pricing.amountPaise,
          currency: plan.pricing.currency,
          keyId: this.getKeyId(),
          status: order.status,
          provider: 'razorpay',
        };
      } catch (err) {
        logger.error({ err, planId: params.planId }, 'Razorpay API order creation failed');
        throw new Error(`Razorpay API Error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Test / Local Mode Mock Order (reproducible for local testing and CI)
    const simulatedOrderId = `order_${crypto.randomBytes(8).toString('hex')}`;
    logger.info(
      { orderId: simulatedOrderId, planId: plan.id, isTestMode: this.isTestMode() },
      'Generated Razorpay checkout order'
    );

    return {
      id: simulatedOrderId,
      planId: plan.id,
      amountPaise: plan.pricing.amountPaise,
      currency: plan.pricing.currency,
      keyId: this.getKeyId(),
      status: 'created',
      provider: 'razorpay',
    };
  }

  /**
   * Cancels a subscription on Razorpay if active.
   */
  public async cancelSubscription(providerSubscriptionId: string, atCycleEnd = true): Promise<boolean> {
    if (this.instance && this.isConfigured() && !config.razorpay.keyId?.includes('placeholder')) {
      try {
        await this.instance.subscriptions.cancel(providerSubscriptionId, atCycleEnd);
        return true;
      } catch (err) {
        logger.error({ err, providerSubscriptionId }, 'Failed to cancel subscription on Razorpay');
        throw err;
      }
    }
    return true;
  }
}

export const razorpayService = new RazorpayService();

