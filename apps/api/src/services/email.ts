import nodemailer, { type Transporter } from 'nodemailer';
import { config, SmtpConfig } from '../config/env.js';
import { logger } from '../config/logger.js';

export interface AlertEmailPayload {
  id: string;
  title: string;
  ruleName: string;
  severity: string;
  summary: string;
  workspaceName?: string;
  eventCount?: number;
  occurredAt?: string;
  evidenceSummary?: string;
}

export interface SentEmailRecord {
  to: string;
  subject: string;
  type: 'verification' | 'password_reset' | 'alert_notification';
  token?: string;
  actionUrl?: string;
  alertPayload?: AlertEmailPayload;
  messageId?: string;
  html?: string;
  text?: string;
  sentAt: Date;
}

export const inMemorySentEmails: SentEmailRecord[] = [];

export interface EmailService {
  readonly providerName: string;
  sendVerificationEmail(to: string, rawToken: string): Promise<boolean>;
  sendPasswordResetEmail(to: string, rawToken: string): Promise<boolean>;
  sendAlertNotificationEmail(to: string, alert: AlertEmailPayload): Promise<boolean>;
}

export class EmailDeliveryError extends Error {
  public readonly originalError?: unknown;
  constructor(message: string, originalError?: unknown) {
    super(message);
    this.name = 'EmailDeliveryError';
    this.originalError = originalError;
  }
}

// ---------------------------------------------------------------------------
// Email Content Builders (HTML + Plain Text)
// ---------------------------------------------------------------------------

function baseHtmlTemplate(title: string, contentHtml: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f1f5f9; padding: 32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width: 600px; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -2px rgba(0, 0, 0, 0.05); border: 1px solid #e2e8f0;">
          <!-- Header -->
          <tr>
            <td style="background-color: #0f172a; padding: 24px 32px; text-align: left;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td>
                    <span style="font-size: 20px; font-weight: 700; color: #38bdf8; letter-spacing: 0.5px;">NOMAA<span style="color: #ffffff;">NOS</span> SENTINEL</span>
                    <span style="display: block; font-size: 11px; color: #94a3b8; text-transform: uppercase; letter-spacing: 1.5px; margin-top: 4px;">Cybersecurity Threat Detection Platform</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding: 32px;">
              ${contentHtml}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background-color: #f8fafc; padding: 20px 32px; border-top: 1px solid #e2e8f0; text-align: center; font-size: 12px; color: #64748b; line-height: 1.5;">
              <p style="margin: 0 0 8px 0;">This is an automated security communication from NomaanOS Sentinel.</p>
              <p style="margin: 0;">Do not reply directly to this email. For assistance, contact your workspace administrator.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function buildVerificationEmail(to: string, rawToken: string, webUrl: string) {
  const actionUrl = `${webUrl}/verify-email?token=${encodeURIComponent(rawToken)}`;
  const subject = 'Verify your NomaanOS Sentinel account';

  const text = `NomaanOS Sentinel — Email Verification

Welcome to NomaanOS Sentinel!

Please verify your email address (${to}) to activate your account and access your security workspaces.

Verify your account by visiting the link below:
${actionUrl}

Note: This single-use verification link will expire in 24 hours.

Security Notice: If you did not register for an account on NomaanOS Sentinel, please ignore this email.`;

  const contentHtml = `
    <h1 style="font-size: 22px; font-weight: 700; color: #0f172a; margin-top: 0; margin-bottom: 16px;">Verify your email address</h1>
    <p style="font-size: 15px; line-height: 1.6; color: #334155; margin-bottom: 24px;">
      Welcome to NomaanOS Sentinel. To activate your account and start investigating security events, please verify your email address (<strong>${to}</strong>).
    </p>
    <div style="text-align: center; margin: 32px 0;">
      <a href="${actionUrl}" style="background-color: #0284c7; color: #ffffff; padding: 12px 28px; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 15px; display: inline-block;">Verify Email Address</a>
    </div>
    <p style="font-size: 13px; color: #64748b; line-height: 1.5; margin-top: 24px;">
      Or copy and paste this verification URL into your browser:<br>
      <a href="${actionUrl}" style="color: #0284c7; word-break: break-all;">${actionUrl}</a>
    </p>
    <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
    <p style="font-size: 12px; color: #94a3b8; margin: 0;">
      This single-use link expires in 24 hours. If you did not create a NomaanOS Sentinel account, you can safely ignore this message.
    </p>
  `;

  return { subject, actionUrl, text, html: baseHtmlTemplate(subject, contentHtml) };
}

export function buildPasswordResetEmail(to: string, rawToken: string, webUrl: string) {
  const actionUrl = `${webUrl}/reset-password?token=${encodeURIComponent(rawToken)}`;
  const subject = 'Reset your NomaanOS Sentinel password';

  const text = `NomaanOS Sentinel — Password Reset Request

We received a request to reset the password for your account (${to}).

Reset your password by visiting the link below:
${actionUrl}

Note: This single-use reset link will expire in 1 hour.

Security Notice: If you did not request a password reset, your credentials may be targeted. Please review your account security immediately or contact your administrator.`;

  const contentHtml = `
    <h1 style="font-size: 22px; font-weight: 700; color: #0f172a; margin-top: 0; margin-bottom: 16px;">Password Reset Request</h1>
    <p style="font-size: 15px; line-height: 1.6; color: #334155; margin-bottom: 24px;">
      We received a request to reset the password for your NomaanOS Sentinel account (<strong>${to}</strong>).
    </p>
    <div style="text-align: center; margin: 32px 0;">
      <a href="${actionUrl}" style="background-color: #0284c7; color: #ffffff; padding: 12px 28px; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 15px; display: inline-block;">Reset Password</a>
    </div>
    <p style="font-size: 13px; color: #64748b; line-height: 1.5; margin-top: 24px;">
      Or copy and paste this URL into your browser:<br>
      <a href="${actionUrl}" style="color: #0284c7; word-break: break-all;">${actionUrl}</a>
    </p>
    <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
    <p style="font-size: 12px; color: #94a3b8; margin: 0;">
      This link will expire in 1 hour. If you did not request a password reset, please secure your account immediately.
    </p>
  `;

  return { subject, actionUrl, text, html: baseHtmlTemplate(subject, contentHtml) };
}

export function buildAlertNotificationEmail(to: string, alert: AlertEmailPayload, webUrl: string) {
  const actionUrl = `${webUrl}/workspaces`;
  const severityUpper = alert.severity.toUpperCase();
  const subject = `[SECURITY ALERT] [${severityUpper}] ${alert.title}`;

  let badgeBg = '#f1f5f9';
  let badgeColor = '#475569';
  let badgeBorder = '#cbd5e1';

  switch (alert.severity.toLowerCase()) {
    case 'critical':
      badgeBg = '#fee2e2';
      badgeColor = '#991b1b';
      badgeBorder = '#f87171';
      break;
    case 'high':
      badgeBg = '#ffedd5';
      badgeColor = '#9a3412';
      badgeBorder = '#fb923c';
      break;
    case 'medium':
      badgeBg = '#fef3c7';
      badgeColor = '#92400e';
      badgeBorder = '#fcd34d';
      break;
    case 'low':
      badgeBg = '#dbeafe';
      badgeColor = '#1e40af';
      badgeBorder = '#60a5fa';
      break;
    case 'info':
      badgeBg = '#d1fae5';
      badgeColor = '#065f46';
      badgeBorder = '#34d399';
      break;
  }

  const text = `[SECURITY ALERT] [${severityUpper}] ${alert.title}
NomaanOS Sentinel Threat Detection

Alert Details:
- Severity: ${severityUpper}
- Detection Rule: ${alert.ruleName}
- Workspace: ${alert.workspaceName || 'Primary Workspace'}
- Event Count: ${alert.eventCount ?? 1}
- Occurred At: ${alert.occurredAt || new Date().toISOString()}

Summary:
${alert.summary}
${alert.evidenceSummary ? `\nEvidence:\n${alert.evidenceSummary}\n` : ''}
Investigate this alert in the Sentinel Console:
${actionUrl}`;

  const contentHtml = `
    <div style="margin-bottom: 20px;">
      <span style="display: inline-block; padding: 4px 12px; border-radius: 9999px; font-size: 12px; font-weight: 700; background-color: ${badgeBg}; color: ${badgeColor}; border: 1px solid ${badgeBorder}; letter-spacing: 0.5px;">
        ${severityUpper} SEVERITY
      </span>
    </div>
    <h1 style="font-size: 20px; font-weight: 700; color: #0f172a; margin-top: 0; margin-bottom: 12px;">
      ${alert.title}
    </h1>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin: 20px 0; background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; font-size: 13px;">
      <tr>
        <td style="padding: 10px 16px; border-bottom: 1px solid #e2e8f0; color: #64748b; width: 30%;">Detection Rule</td>
        <td style="padding: 10px 16px; border-bottom: 1px solid #e2e8f0; color: #0f172a; font-weight: 600;">${alert.ruleName}</td>
      </tr>
      <tr>
        <td style="padding: 10px 16px; border-bottom: 1px solid #e2e8f0; color: #64748b;">Workspace</td>
        <td style="padding: 10px 16px; border-bottom: 1px solid #e2e8f0; color: #0f172a;">${alert.workspaceName || 'Primary Workspace'}</td>
      </tr>
      <tr>
        <td style="padding: 10px 16px; border-bottom: 1px solid #e2e8f0; color: #64748b;">Event Count</td>
        <td style="padding: 10px 16px; border-bottom: 1px solid #e2e8f0; color: #0f172a;">${alert.eventCount ?? 1}</td>
      </tr>
      <tr>
        <td style="padding: 10px 16px; color: #64748b;">Detected At</td>
        <td style="padding: 10px 16px; color: #0f172a;">${alert.occurredAt || new Date().toISOString()}</td>
      </tr>
    </table>
    <h3 style="font-size: 14px; font-weight: 600; color: #334155; margin-bottom: 8px;">Analysis Summary</h3>
    <div style="background-color: #ffffff; border-left: 4px solid #0284c7; padding: 12px 16px; margin-bottom: 24px; font-size: 14px; line-height: 1.6; color: #334155;">
      ${alert.summary}
      ${alert.evidenceSummary ? `<div style="margin-top: 8px; font-size: 13px; color: #64748b;"><strong>Evidence:</strong> ${alert.evidenceSummary}</div>` : ''}
    </div>
    <div style="text-align: center; margin: 28px 0 16px 0;">
      <a href="${actionUrl}" style="background-color: #0f172a; color: #ffffff; padding: 12px 28px; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 14px; display: inline-block;">Open Investigation Console</a>
    </div>
  `;

  return { subject, actionUrl, text, html: baseHtmlTemplate(subject, contentHtml) };
}

// ---------------------------------------------------------------------------
// Provider Implementations
// ---------------------------------------------------------------------------

export class DevelopmentEmailService implements EmailService {
  public readonly providerName = 'development';

  constructor(private readonly webUrl: string = config.email.webUrl) {}

  async sendVerificationEmail(to: string, rawToken: string): Promise<boolean> {
    const { subject, actionUrl, text, html } = buildVerificationEmail(to, rawToken, this.webUrl);

    inMemorySentEmails.push({
      to: to.toLowerCase(),
      subject,
      type: 'verification',
      token: rawToken,
      actionUrl,
      text,
      html,
      sentAt: new Date(),
    });

    logger.info({ to, type: 'verification' }, '[DEV-EMAIL] Verification email recorded in memory store');
    return true;
  }

  async sendPasswordResetEmail(to: string, rawToken: string): Promise<boolean> {
    const { subject, actionUrl, text, html } = buildPasswordResetEmail(to, rawToken, this.webUrl);

    inMemorySentEmails.push({
      to: to.toLowerCase(),
      subject,
      type: 'password_reset',
      token: rawToken,
      actionUrl,
      text,
      html,
      sentAt: new Date(),
    });

    logger.info({ to, type: 'password_reset' }, '[DEV-EMAIL] Password reset email recorded in memory store');
    return true;
  }

  async sendAlertNotificationEmail(to: string, alert: AlertEmailPayload): Promise<boolean> {
    const { subject, actionUrl, text, html } = buildAlertNotificationEmail(to, alert, this.webUrl);

    inMemorySentEmails.push({
      to: to.toLowerCase(),
      subject,
      type: 'alert_notification',
      actionUrl,
      alertPayload: alert,
      text,
      html,
      sentAt: new Date(),
    });

    logger.info(
      { to, type: 'alert_notification', alertId: alert.id, severity: alert.severity },
      '[DEV-EMAIL] Alert notification recorded in memory store'
    );
    return true;
  }
}

export class SmtpEmailService implements EmailService {
  public readonly providerName = 'smtp';
  private readonly transporter: Transporter;
  private readonly fromAddress: string;
  private readonly webUrl: string;
  private readonly smtpConfig: SmtpConfig;

  constructor(
    smtpConfig: SmtpConfig,
    fromAddress: string = config.email.from,
    webUrl: string = config.email.webUrl,
    customTransporter?: Transporter
  ) {
    this.smtpConfig = smtpConfig;
    this.fromAddress = fromAddress;
    this.webUrl = webUrl;

    if (customTransporter) {
      this.transporter = customTransporter;
    } else {
      this.transporter = nodemailer.createTransport({
        host: smtpConfig.host,
        port: smtpConfig.port,
        secure: smtpConfig.secure,
        auth: (smtpConfig.user && smtpConfig.pass)
          ? { user: smtpConfig.user, pass: smtpConfig.pass }
          : undefined,
        connectionTimeout: 10000,
        greetingTimeout: 5000,
        socketTimeout: 15000,
      });
    }
  }

  private sanitize(message: string, sensitiveToken?: string): string {
    let cleaned = message;
    if (this.smtpConfig.pass) {
      cleaned = cleaned.split(this.smtpConfig.pass).join('[REDACTED]');
    }
    if (sensitiveToken) {
      cleaned = cleaned.split(sensitiveToken).join('[REDACTED]');
    }
    return cleaned;
  }

  async sendVerificationEmail(to: string, rawToken: string): Promise<boolean> {
    const { subject, actionUrl, text, html } = buildVerificationEmail(to, rawToken, this.webUrl);

    try {
      const info = await this.transporter.sendMail({
        from: this.fromAddress,
        to,
        subject,
        text,
        html,
      });

      inMemorySentEmails.push({
        to: to.toLowerCase(),
        subject,
        type: 'verification',
        token: rawToken,
        actionUrl,
        messageId: info.messageId,
        text,
        html,
        sentAt: new Date(),
      });

      logger.info(
        { to, type: 'verification', messageId: info.messageId },
        'Verification email successfully dispatched via SMTP'
      );
      return true;
    } catch (err: unknown) {
      const rawMsg = err instanceof Error ? err.message : String(err);
      const sanitized = this.sanitize(rawMsg, rawToken);
      logger.error({ to, type: 'verification', err: sanitized }, 'Failed to deliver verification email via SMTP');
      throw new EmailDeliveryError(`SMTP delivery failed for verification email: ${sanitized}`, err);
    }
  }

  async sendPasswordResetEmail(to: string, rawToken: string): Promise<boolean> {
    const { subject, actionUrl, text, html } = buildPasswordResetEmail(to, rawToken, this.webUrl);

    try {
      const info = await this.transporter.sendMail({
        from: this.fromAddress,
        to,
        subject,
        text,
        html,
      });

      inMemorySentEmails.push({
        to: to.toLowerCase(),
        subject,
        type: 'password_reset',
        token: rawToken,
        actionUrl,
        messageId: info.messageId,
        text,
        html,
        sentAt: new Date(),
      });

      logger.info(
        { to, type: 'password_reset', messageId: info.messageId },
        'Password reset email successfully dispatched via SMTP'
      );
      return true;
    } catch (err: unknown) {
      const rawMsg = err instanceof Error ? err.message : String(err);
      const sanitized = this.sanitize(rawMsg, rawToken);
      logger.error({ to, type: 'password_reset', err: sanitized }, 'Failed to deliver password reset email via SMTP');
      throw new EmailDeliveryError(`SMTP delivery failed for password reset email: ${sanitized}`, err);
    }
  }

  async sendAlertNotificationEmail(to: string, alert: AlertEmailPayload): Promise<boolean> {
    const { subject, actionUrl, text, html } = buildAlertNotificationEmail(to, alert, this.webUrl);

    try {
      const info = await this.transporter.sendMail({
        from: this.fromAddress,
        to,
        subject,
        text,
        html,
      });

      inMemorySentEmails.push({
        to: to.toLowerCase(),
        subject,
        type: 'alert_notification',
        actionUrl,
        alertPayload: alert,
        messageId: info.messageId,
        text,
        html,
        sentAt: new Date(),
      });

      logger.info(
        { to, type: 'alert_notification', alertId: alert.id, messageId: info.messageId },
        'Alert notification email successfully dispatched via SMTP'
      );
      return true;
    } catch (err: unknown) {
      const rawMsg = err instanceof Error ? err.message : String(err);
      const sanitized = this.sanitize(rawMsg);
      logger.error(
        { to, type: 'alert_notification', alertId: alert.id, err: sanitized },
        'Failed to deliver alert email via SMTP'
      );
      throw new EmailDeliveryError(`SMTP delivery failed for alert notification email: ${sanitized}`, err);
    }
  }
}

// ---------------------------------------------------------------------------
// Factory & Delegating Singleton
// ---------------------------------------------------------------------------

export function createEmailService(overrideConfig?: {
  provider?: string;
  from?: string;
  webUrl?: string;
  smtp?: SmtpConfig;
}): EmailService {
  const provider = (overrideConfig?.provider || config.email.provider || 'development').toLowerCase();
  const from = overrideConfig?.from || config.email.from;
  const webUrl = overrideConfig?.webUrl || config.email.webUrl;

  if (provider === 'smtp') {
    const smtp = overrideConfig && 'smtp' in overrideConfig ? overrideConfig.smtp : config.email.smtp;
    if (!smtp || !smtp.host) {
      throw new Error('SMTP configuration missing: host is required for SMTP email service.');
    }
    return new SmtpEmailService(smtp, from, webUrl);
  }

  return new DevelopmentEmailService(webUrl);
}

let activeEmailService: EmailService = config.nodeEnv === 'test'
  ? new DevelopmentEmailService(config.email.webUrl)
  : createEmailService();

export function setEmailService(service: EmailService | null): void {
  activeEmailService = service || createEmailService();
}

export function getEmailService(): EmailService {
  return activeEmailService;
}

export const emailService: EmailService = {
  get providerName() {
    return activeEmailService.providerName;
  },
  sendVerificationEmail(to: string, rawToken: string) {
    return activeEmailService.sendVerificationEmail(to, rawToken);
  },
  sendPasswordResetEmail(to: string, rawToken: string) {
    return activeEmailService.sendPasswordResetEmail(to, rawToken);
  },
  sendAlertNotificationEmail(to: string, alert: AlertEmailPayload) {
    return activeEmailService.sendAlertNotificationEmail(to, alert);
  },
};
