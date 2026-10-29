// apps/api/tests/outbound-webhooks-and-ssrf.test.ts
// Automated Tests for Outbound Alert Webhooks, HMAC Signing, and SSRF Protection

import { describe, it, expect } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/pool.js';
import { config } from '../src/config/env.js';
import { ssrfValidator } from '../src/services/ssrf-validator.js';
import { webhookDispatcher } from '../src/services/webhook-dispatcher.js';
import { billingService } from '../src/services/billing-service.js';

describe('Secure Outbound Alert Webhooks & SSRF Protection', () => {
  const app = createApp();

  const makeUser = async (label: string) => {
    const email = `hook_${label}_${crypto.randomBytes(4).toString('hex')}@example.com`;
    const password = 'Password123!';
    const regRes = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email,
        password,
        fullName: `Hook User ${label}`,
        workspaceName: `Hook Workspace ${label}`,
      });

    const cookieHeader = regRes.headers['set-cookie'] as unknown as string[];
    const sessionCookie = cookieHeader
      .find((c: string) => c.startsWith(`${config.auth.sessionCookieName}=`))!
      .split(';')[0];

    await pool.query('UPDATE users SET is_verified = TRUE WHERE id = $1', [regRes.body.user.id]);

    // Give workspace Starter plan so webhooks are enabled
    await billingService.activateSubscription({
      targetType: 'workspace',
      targetId: regRes.body.workspace.id,
      planId: 'starter',
    });

    return {
      userId: regRes.body.user.id as string,
      email,
      workspaceId: regRes.body.workspace.id as string,
      sessionCookie,
    };
  };

  describe('SSRF Protection Engine', () => {
    it('1. should block loopback, private, link-local, and cloud metadata IPv4 addresses', () => {
      // Loopback
      expect(ssrfValidator.isBlockedIp('127.0.0.1')).toBe(true);
      expect(ssrfValidator.isBlockedIp('127.1.2.3')).toBe(true);

      // Private RFC 1918
      expect(ssrfValidator.isBlockedIp('10.0.0.1')).toBe(true);
      expect(ssrfValidator.isBlockedIp('10.254.254.1')).toBe(true);
      expect(ssrfValidator.isBlockedIp('172.16.0.1')).toBe(true);
      expect(ssrfValidator.isBlockedIp('172.31.255.254')).toBe(true);
      expect(ssrfValidator.isBlockedIp('192.168.1.1')).toBe(true);
      expect(ssrfValidator.isBlockedIp('192.168.0.254')).toBe(true);

      // Cloud Metadata & Link-Local
      expect(ssrfValidator.isBlockedIp('169.254.169.254')).toBe(true);
      expect(ssrfValidator.isBlockedIp('169.254.1.1')).toBe(true);

      // Broadcast & Reserved
      expect(ssrfValidator.isBlockedIp('0.0.0.0')).toBe(true);
      expect(ssrfValidator.isBlockedIp('255.255.255.255')).toBe(true);
      expect(ssrfValidator.isBlockedIp('224.0.0.1')).toBe(true);

      // Public IP (Cloudflare / Google DNS) should NOT be blocked
      expect(ssrfValidator.isBlockedIp('1.1.1.1')).toBe(false);
      expect(ssrfValidator.isBlockedIp('8.8.8.8')).toBe(false);
    });

    it('2. should block IPv6 loopback, link-local, unique-local, and IPv4-mapped IPv6 addresses', () => {
      // IPv6 Loopback
      expect(ssrfValidator.isBlockedIp('::1')).toBe(true);
      expect(ssrfValidator.isBlockedIp('::')).toBe(true);

      // IPv6 Link-Local
      expect(ssrfValidator.isBlockedIp('fe80::1')).toBe(true);
      expect(ssrfValidator.isBlockedIp('fe80::200:5efe:10.0.0.1')).toBe(true);

      // IPv6 Unique Local (fc00::/7 & fd00::/8)
      expect(ssrfValidator.isBlockedIp('fc00::1')).toBe(true);
      expect(ssrfValidator.isBlockedIp('fd00:ec2::254')).toBe(true); // AWS IPv6 metadata

      // IPv4-mapped IPv6
      expect(ssrfValidator.isBlockedIp('::ffff:127.0.0.1')).toBe(true);
      expect(ssrfValidator.isBlockedIp('::ffff:10.0.0.1')).toBe(true);
      expect(ssrfValidator.isBlockedIp('::ffff:169.254.169.254')).toBe(true);
      expect(ssrfValidator.isBlockedIp('::ffff:1.1.1.1')).toBe(false);
    });

    it('3. should reject internal URLs, localhost, and non-HTTPS destinations by default', async () => {
      // Localhost hostname
      const resLocalhost = await ssrfValidator.validateWebhookDestination('https://localhost/webhook');
      expect(resLocalhost.valid).toBe(false);
      expect(resLocalhost.reason).toContain('Blocked local or internal hostname');

      // Private IP directly in URL
      const resPrivateIp = await ssrfValidator.validateWebhookDestination('https://192.168.1.50/alert');
      expect(resPrivateIp.valid).toBe(false);
      expect(resPrivateIp.reason).toContain('private, loopback, or cloud metadata');

      // Cloud metadata in URL
      const resMetadata = await ssrfValidator.validateWebhookDestination('http://169.254.169.254/latest/meta-data');
      expect(resMetadata.valid).toBe(false);

      // Insecure HTTP in production mode (default)
      const resHttp = await ssrfValidator.validateWebhookDestination('http://example.com/webhook', false);
      expect(resHttp.valid).toBe(false);
      expect(resHttp.reason).toContain('HTTPS is required');

      // Valid HTTPS destination
      const resValid = await ssrfValidator.validateWebhookDestination('https://example.com/webhook');
      expect(resValid.valid).toBe(true);
    });
  });

  describe('Webhook Configuration CRUD & RBAC Isolation', () => {
    it('4. should create webhook, mask signing secret in reads, and enforce workspace isolation', async () => {
      const owner = await makeUser('hook_crud');
      const outsider = await makeUser('hook_outsider');

      // 1. Create Webhook
      const createRes = await request(app)
        .post(`/api/v1/workspaces/${owner.workspaceId}/webhooks`)
        .set('Cookie', owner.sessionCookie)
        .send({
          name: 'Corporate SIEM Webhook',
          url: 'https://example.com/siem/webhook',
          minSeverity: 'high',
          subscribedRules: ['ssh_brute_force'],
        });

      expect(createRes.status).toBe(201);
      expect(createRes.body.status).toBe('created');
      expect(createRes.body.webhook.name).toBe('Corporate SIEM Webhook');
      expect(createRes.body.webhook.signingSecret).toBeDefined();
      expect(createRes.body.webhook.signingSecret.startsWith('whsec_')).toBe(true);
      const hookId = createRes.body.webhook.id;

      // 2. Read Webhook Details - signing secret MUST be masked
      const getRes = await request(app)
        .get(`/api/v1/workspaces/${owner.workspaceId}/webhooks/${hookId}`)
        .set('Cookie', owner.sessionCookie);

      expect(getRes.status).toBe(200);
      expect(getRes.body.webhook.signingSecret).toBeUndefined();
      expect(getRes.body.webhook.signingSecretMasked).toContain('...');

      // 3. Outsider CANNOT read or modify owner's webhook
      const outsiderGet = await request(app)
        .get(`/api/v1/workspaces/${owner.workspaceId}/webhooks/${hookId}`)
        .set('Cookie', outsider.sessionCookie);
      expect(outsiderGet.status).toBe(403);

      const outsiderDelete = await request(app)
        .delete(`/api/v1/workspaces/${owner.workspaceId}/webhooks/${hookId}`)
        .set('Cookie', outsider.sessionCookie);
      expect(outsiderDelete.status).toBe(403);

      // 4. Secret Rotation
      const rotateRes = await request(app)
        .post(`/api/v1/workspaces/${owner.workspaceId}/webhooks/${hookId}/rotate-secret`)
        .set('Cookie', owner.sessionCookie);

      expect(rotateRes.status).toBe(200);
      expect(rotateRes.body.signingSecret).toBeDefined();
      expect(rotateRes.body.signingSecret).not.toBe(createRes.body.webhook.signingSecret);

      // 5. Delete Webhook
      const delRes = await request(app)
        .delete(`/api/v1/workspaces/${owner.workspaceId}/webhooks/${hookId}`)
        .set('Cookie', owner.sessionCookie);

      expect(delRes.status).toBe(200);
    });

    it('5. should reject webhook creation targeting internal/private URLs via API', async () => {
      const owner = await makeUser('hook_ssrf_api');

      // Attempting to create webhook to internal IP must fail with 400 SSRF_VALIDATION_ERROR
      const ssrfAttempt = await request(app)
        .post(`/api/v1/workspaces/${owner.workspaceId}/webhooks`)
        .set('Cookie', owner.sessionCookie)
        .send({
          name: 'Malicious Internal Hook',
          url: 'http://169.254.169.254/latest/meta-data',
        });

      expect(ssrfAttempt.status).toBe(400);
      expect(ssrfAttempt.body.error).toBe('SSRF_VALIDATION_ERROR');
    });
  });

  describe('HMAC Payload Signing & Recipient Verification', () => {
    it('6. should correctly sign payloads and verify recipient signatures with replay tolerance', () => {
      const secret = 'whsec_sample_secret_key_1234567890';
      const payload = JSON.stringify({
        event_type: 'security_alert.created',
        alert: { id: 'alert-1', title: 'Brute Force Attack', severity: 'critical' },
      });

      const currentTimestamp = Math.floor(Date.now() / 1000);
      const { header, signature } = webhookDispatcher.signPayload(payload, secret, currentTimestamp);

      expect(header).toBe(`t=${currentTimestamp},v1=${signature}`);

      // 1. Valid signature within replay window passes
      const validCheck = webhookDispatcher.verifyRecipientSignature(payload, header, secret, 300);
      expect(validCheck.valid).toBe(true);

      // 2. Tampered payload fails
      const tamperedCheck = webhookDispatcher.verifyRecipientSignature(
        JSON.stringify({ ...JSON.parse(payload), tampered: true }),
        header,
        secret,
        300
      );
      expect(tamperedCheck.valid).toBe(false);
      expect(tamperedCheck.reason).toContain('signature mismatch');

      // 3. Expired timestamp outside replay window fails
      const expiredTimestamp = currentTimestamp - 600; // 10 minutes ago
      const expiredHeader = `t=${expiredTimestamp},v1=${signature}`;
      const expiredCheck = webhookDispatcher.verifyRecipientSignature(payload, expiredHeader, secret, 300);
      expect(expiredCheck.valid).toBe(false);
      expect(expiredCheck.reason).toContain('replay window');

      // 4. Incorrect secret fails
      const wrongSecretCheck = webhookDispatcher.verifyRecipientSignature(payload, header, 'whsec_wrong_secret', 300);
      expect(wrongSecretCheck.valid).toBe(false);
    });

    it('7. should record delivery attempts and expose delivery audit history', async () => {
      const owner = await makeUser('hook_history');

      // Create a webhook
      const hookRes = await request(app)
        .post(`/api/v1/workspaces/${owner.workspaceId}/webhooks`)
        .set('Cookie', owner.sessionCookie)
        .send({
          name: 'History Test Webhook',
          url: 'https://example.com/alerts',
          minSeverity: 'low',
        });

      const hookId = hookRes.body.webhook.id;

      // Manually trigger test delivery
      const testRes = await request(app)
        .post(`/api/v1/workspaces/${owner.workspaceId}/webhooks/${hookId}/test`)
        .set('Cookie', owner.sessionCookie);

      expect(testRes.status).toBe(200);
      expect(testRes.body.delivery).toBeDefined();

      // Retrieve delivery history via API
      const historyRes = await request(app)
        .get(`/api/v1/workspaces/${owner.workspaceId}/webhooks/${hookId}/deliveries`)
        .set('Cookie', owner.sessionCookie);

      expect(historyRes.status).toBe(200);
      expect(historyRes.body.deliveries.length).toBeGreaterThanOrEqual(1);
      expect(historyRes.body.deliveries[0].webhookId).toBe(hookId);
      expect(historyRes.body.deliveries[0].attemptCount).toBe(1);

      const deliveryId = historyRes.body.deliveries[0].id;

      // Retry the delivery via API
      const retryRes = await request(app)
        .post(`/api/v1/workspaces/${owner.workspaceId}/webhooks/${hookId}/deliveries/${deliveryId}/retry`)
        .set('Cookie', owner.sessionCookie);

      expect(retryRes.status).toBe(200);
      expect(retryRes.body.delivery.attemptCount).toBeGreaterThanOrEqual(2);
    });
  });
});

