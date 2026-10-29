import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/pool.js';
import { config, loadConfig, SmtpConfig } from '../src/config/env.js';
import {
  emailService,
  setEmailService,
  createEmailService,
  DevelopmentEmailService,
  SmtpEmailService,
  EmailDeliveryError,
  inMemorySentEmails,
  buildVerificationEmail,
  buildPasswordResetEmail,
  buildAlertNotificationEmail,
  AlertEmailPayload,
} from '../src/services/email.js';

describe('Mailtrap Email Sandbox SMTP & Provider Service Suite', () => {
  const app = createApp();
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Reset active email service to default development service
    setEmailService(null);
    inMemorySentEmails.length = 0;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    setEmailService(null);
    inMemorySentEmails.length = 0;
  });

  describe('1. Provider Selection and Factory Resolution', () => {
    it('creates a DevelopmentEmailService when provider is explicitly "development"', () => {
      const service = createEmailService({ provider: 'development' });
      expect(service).toBeInstanceOf(DevelopmentEmailService);
      expect(service.providerName).toBe('development');
    });

    it('creates an SmtpEmailService when provider is explicitly "smtp"', () => {
      const smtp: SmtpConfig = {
        host: 'sandbox.smtp.mailtrap.io',
        port: 2525,
        secure: false,
        user: 'mailtrap_test_user',
        pass: 'mailtrap_test_pass',
      };

      const service = createEmailService({ provider: 'smtp', smtp });
      expect(service).toBeInstanceOf(SmtpEmailService);
      expect(service.providerName).toBe('smtp');
    });

    it('throws a descriptive error when provider is "smtp" but SMTP configuration is missing', () => {
      expect(() => {
        createEmailService({ provider: 'smtp', smtp: undefined });
      }).toThrow(/SMTP configuration missing/i);
    });

    it('supports dynamic service replacement via setEmailService', () => {
      const customDev = new DevelopmentEmailService('https://custom.sentinel.soc');
      setEmailService(customDev);
      expect(emailService.providerName).toBe('development');
    });
  });

  describe('2. SMTP Configuration Validation in loadConfig', () => {
    it('validates required SMTP_HOST when EMAIL_PROVIDER is "smtp"', () => {
      process.env.EMAIL_PROVIDER = 'smtp';
      delete process.env.SMTP_HOST;

      expect(() => loadConfig()).toThrow(/SMTP_HOST must be configured when EMAIL_PROVIDER is set to "smtp"/);
    });

    it('rejects invalid or out-of-range SMTP_PORT', () => {
      process.env.EMAIL_PROVIDER = 'smtp';
      process.env.SMTP_HOST = 'sandbox.smtp.mailtrap.io';
      process.env.SMTP_PORT = '70000';

      expect(() => loadConfig()).toThrow(/Invalid SMTP_PORT/);

      process.env.SMTP_PORT = 'not_a_number';
      expect(() => loadConfig()).toThrow(/Invalid SMTP_PORT/);
    });

    it('parses valid Mailtrap SMTP environment options correctly', () => {
      process.env.NODE_ENV = 'development';
      process.env.EMAIL_PROVIDER = 'smtp';
      process.env.SMTP_HOST = 'sandbox.smtp.mailtrap.io';
      process.env.SMTP_PORT = '2525';
      process.env.SMTP_USER = 'mailtrap_user_99';
      process.env.SMTP_PASSWORD = 'mailtrap_password_secret';
      process.env.SMTP_SECURE = 'false';
      process.env.EMAIL_FROM = 'NomaanOS SOC <alerts@sentinel.local>';

      const cfg = loadConfig();
      expect(cfg.email.provider).toBe('smtp');
      expect(cfg.email.from).toBe('NomaanOS SOC <alerts@sentinel.local>');
      expect(cfg.email.smtp).toBeDefined();
      expect(cfg.email.smtp?.host).toBe('sandbox.smtp.mailtrap.io');
      expect(cfg.email.smtp?.port).toBe(2525);
      expect(cfg.email.smtp?.user).toBe('mailtrap_user_99');
      expect(cfg.email.smtp?.pass).toBe('mailtrap_password_secret');
      expect(cfg.email.smtp?.secure).toBe(false);
    });

    it('enforces SMTP_USER and SMTP_PASSWORD in production environment when EMAIL_PROVIDER is "smtp"', () => {
      process.env.NODE_ENV = 'production';
      process.env.DATABASE_PASSWORD = 'strong_prod_db_pass';
      process.env.SESSION_SECRET = 'strong_prod_session_secret_at_least_32_characters';
      process.env.EMAIL_PROVIDER = 'smtp';
      process.env.SMTP_HOST = 'sandbox.smtp.mailtrap.io';
      delete process.env.SMTP_USER;
      delete process.env.SMTP_USERNAME;
      delete process.env.SMTP_PASS;
      delete process.env.SMTP_PASSWORD;

      expect(() => loadConfig()).toThrow(/SMTP_USER and SMTP_PASSWORD must be configured in production/);
    });
  });

  describe('3. Template Formatting (HTML and Plain Text)', () => {
    it('builds account verification email with valid action URL and text content', () => {
      const email = buildVerificationEmail('analyst@soc.corp', 'raw_verif_token_123', 'http://localhost:3000');
      expect(email.subject).toBe('Verify your NomaanOS Sentinel account');
      expect(email.actionUrl).toBe('http://localhost:3000/verify-email?token=raw_verif_token_123');
      expect(email.text).toContain('http://localhost:3000/verify-email?token=raw_verif_token_123');
      expect(email.text).toContain('analyst@soc.corp');
      expect(email.html).toContain('Verify your email address');
      expect(email.html).toContain('http://localhost:3000/verify-email?token=raw_verif_token_123');
      expect(email.html).toContain('24 hours');
    });

    it('builds password reset email with valid action URL and text content', () => {
      const email = buildPasswordResetEmail('analyst@soc.corp', 'raw_reset_token_456', 'http://localhost:3000');
      expect(email.subject).toBe('Reset your NomaanOS Sentinel password');
      expect(email.actionUrl).toBe('http://localhost:3000/reset-password?token=raw_reset_token_456');
      expect(email.text).toContain('http://localhost:3000/reset-password?token=raw_reset_token_456');
      expect(email.html).toContain('Password Reset Request');
      expect(email.html).toContain('1 hour');
    });

    it('builds security alert notification email with color-coded severity styling', () => {
      const alert: AlertEmailPayload = {
        id: 'alt_test_001',
        title: 'Brute Force SSH Attack Detected',
        ruleName: 'ssh_brute_force_rapid',
        severity: 'critical',
        summary: 'More than 20 failed login attempts within 60 seconds from IP 198.51.100.42.',
        workspaceName: 'Acme SOC Workspace',
        eventCount: 24,
        occurredAt: '2026-10-28T10:00:00Z',
        evidenceSummary: '24 security events recorded across port 22.',
      };

      const email = buildAlertNotificationEmail('lead_analyst@soc.corp', alert, 'http://localhost:3000');
      expect(email.subject).toContain('[SECURITY ALERT] [CRITICAL]');
      expect(email.subject).toContain('Brute Force SSH Attack');
      expect(email.text).toContain('Rule: ssh_brute_force_rapid');
      expect(email.text).toContain('Workspace: Acme SOC Workspace');
      expect(email.text).toContain('Event Count: 24');
      expect(email.html).toContain('CRITICAL SEVERITY');
      expect(email.html).toContain('Brute Force SSH Attack Detected');
      expect(email.html).toContain('ssh_brute_force_rapid');
      expect(email.html).toContain('Acme SOC Workspace');
    });
  });

  describe('4. SMTP Successful Delivery (Mock Transporter)', () => {
    const smtpConfig: SmtpConfig = {
      host: 'sandbox.smtp.mailtrap.io',
      port: 2525,
      secure: false,
      user: 'mailtrap_user_sandbox',
      pass: 'mailtrap_pass_sandbox',
    };

    it('sends account verification email through SMTP and records delivery metadata', async () => {
      const mockSendMail = vi.fn().mockResolvedValue({
        messageId: '<msg_verif_001@mailtrap.io>',
        response: '250 2.0.0 OK queued as 12345',
      });
      const mockTransporter = { sendMail: mockSendMail } as any;

      const smtpService = new SmtpEmailService(
        smtpConfig,
        'NomaanOS Sentinel <noreply@sentinel.local>',
        'http://localhost:3000',
        mockTransporter
      );

      const result = await smtpService.sendVerificationEmail('user@corp.internal', 'secure_token_abc');
      expect(result).toBe(true);
      expect(mockSendMail).toHaveBeenCalledTimes(1);

      const sendArgs = mockSendMail.mock.calls[0][0];
      expect(sendArgs.to).toBe('user@corp.internal');
      expect(sendArgs.from).toBe('NomaanOS Sentinel <noreply@sentinel.local>');
      expect(sendArgs.subject).toBe('Verify your NomaanOS Sentinel account');
      expect(sendArgs.text).toContain('verify-email?token=secure_token_abc');
      expect(sendArgs.html).toContain('Verify Email Address');

      // Verifies delivery was pushed to inMemorySentEmails for verification
      const sent = inMemorySentEmails.find((e) => e.to === 'user@corp.internal');
      expect(sent).toBeDefined();
      expect(sent?.messageId).toBe('<msg_verif_001@mailtrap.io>');
      expect(sent?.type).toBe('verification');
    });

    it('sends password reset email through SMTP with valid reset links', async () => {
      const mockSendMail = vi.fn().mockResolvedValue({
        messageId: '<msg_reset_002@mailtrap.io>',
        response: '250 2.0.0 OK queued as 67890',
      });
      const mockTransporter = { sendMail: mockSendMail } as any;

      const smtpService = new SmtpEmailService(
        smtpConfig,
        'NomaanOS Sentinel <noreply@sentinel.local>',
        'http://localhost:3000',
        mockTransporter
      );

      const result = await smtpService.sendPasswordResetEmail('target@corp.internal', 'reset_tok_xyz');
      expect(result).toBe(true);
      expect(mockSendMail).toHaveBeenCalledTimes(1);

      const sendArgs = mockSendMail.mock.calls[0][0];
      expect(sendArgs.to).toBe('target@corp.internal');
      expect(sendArgs.subject).toBe('Reset your NomaanOS Sentinel password');
      expect(sendArgs.text).toContain('reset-password?token=reset_tok_xyz');
      expect(sendArgs.html).toContain('Reset Password');
    });

    it('sends security alert notification email with complete incident context', async () => {
      const mockSendMail = vi.fn().mockResolvedValue({
        messageId: '<msg_alert_003@mailtrap.io>',
        response: '250 2.0.0 OK queued as 11111',
      });
      const mockTransporter = { sendMail: mockSendMail } as any;

      const smtpService = new SmtpEmailService(
        smtpConfig,
        'NomaanOS Sentinel <noreply@sentinel.local>',
        'http://localhost:3000',
        mockTransporter
      );

      const alertPayload: AlertEmailPayload = {
        id: 'alt_999',
        title: 'Privilege Escalation via Sudo',
        ruleName: 'priv_esc_sudo',
        severity: 'high',
        summary: 'User www-data executed /bin/bash as root.',
        workspaceName: 'Production Cloud SOC',
        eventCount: 3,
      };

      const result = await smtpService.sendAlertNotificationEmail('soc_tier2@corp.internal', alertPayload);
      expect(result).toBe(true);
      expect(mockSendMail).toHaveBeenCalledTimes(1);

      const sendArgs = mockSendMail.mock.calls[0][0];
      expect(sendArgs.to).toBe('soc_tier2@corp.internal');
      expect(sendArgs.subject).toContain('[SECURITY ALERT] [HIGH] Privilege Escalation via Sudo');
      expect(sendArgs.text).toContain('priv_esc_sudo');
      expect(sendArgs.html).toContain('HIGH SEVERITY');
    });
  });

  describe('5. SMTP Delivery Failures & Error Handling', () => {
    const smtpConfig: SmtpConfig = {
      host: 'sandbox.smtp.mailtrap.io',
      port: 2525,
      secure: false,
      user: 'mailtrap_user_sandbox',
      pass: 'secret_smtp_password_must_never_leak',
    };

    it('throws EmailDeliveryError and does not report success when SMTP connection times out', async () => {
      const mockSendMail = vi.fn().mockRejectedValue(new Error('ETIMEDOUT: Connection timed out to sandbox.smtp.mailtrap.io:2525'));
      const mockTransporter = { sendMail: mockSendMail } as any;

      const smtpService = new SmtpEmailService(
        smtpConfig,
        'noreply@sentinel.local',
        'http://localhost:3000',
        mockTransporter
      );

      await expect(
        smtpService.sendVerificationEmail('victim@corp.internal', 'raw_token_should_not_leak_in_error')
      ).rejects.toThrow(EmailDeliveryError);
    });

    it('sanitizes SMTP password and raw tokens from the thrown error message', async () => {
      const sensitiveToken = 'super_secret_verif_token_999';
      const mockSendMail = vi.fn().mockRejectedValue(
        new Error(`SMTP Auth failed with password ${smtpConfig.pass} while processing ${sensitiveToken}`)
      );
      const mockTransporter = { sendMail: mockSendMail } as any;

      const smtpService = new SmtpEmailService(
        smtpConfig,
        'noreply@sentinel.local',
        'http://localhost:3000',
        mockTransporter
      );

      try {
        await smtpService.sendVerificationEmail('victim@corp.internal', sensitiveToken);
        expect.unreachable('Should have thrown EmailDeliveryError');
      } catch (err: any) {
        expect(err).toBeInstanceOf(EmailDeliveryError);
        expect(err.message).not.toContain(smtpConfig.pass);
        expect(err.message).not.toContain(sensitiveToken);
        expect(err.message).toContain('[REDACTED]');
      }
    });

    it('ensures /resend-verification endpoint fails cleanly with 500 when SMTP delivery rejects', async () => {
      // 1. Register a test user with development service to create valid database records
      const email = `smtp_fail_${crypto.randomBytes(4).toString('hex')}@example.com`;
      const regRes = await request(app)
        .post('/api/v1/auth/register')
        .send({
          email,
          password: 'Password123!',
          fullName: 'SMTP Failure Test User',
          workspaceName: 'SMTP Failure Test Workspace',
        });
      expect(regRes.status).toBe(201);

      const cookieHeader = regRes.headers['set-cookie'] as unknown as string[];
      const sessionCookie = cookieHeader
        .find((c: string) => c.startsWith(`${config.auth.sessionCookieName}=`))!
        .split(';')[0];

      // 2. Switch global emailService to a failing SMTP service
      const mockFailingSendMail = vi.fn().mockRejectedValue(new Error('ECONNREFUSED: Connection refused to SMTP server'));
      const failingSmtpService = new SmtpEmailService(
        smtpConfig,
        'noreply@sentinel.local',
        'http://localhost:3000',
        { sendMail: mockFailingSendMail } as any
      );
      setEmailService(failingSmtpService);

      // 3. Trigger /resend-verification: must NOT report success! Must fail.
      const resendRes = await request(app)
        .post('/api/v1/auth/resend-verification')
        .set('Cookie', sessionCookie);

      expect(resendRes.status).toBe(500);
      expect(resendRes.body.status).not.toBe('ok');
    });
  });
});

