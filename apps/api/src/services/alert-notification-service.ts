import { pool } from '../database/pool.js';
import { emailService, AlertEmailPayload } from './email.js';
import { logger } from '../config/logger.js';

export interface WorkspaceNotificationSettings {
  id?: string;
  workspaceId: string;
  enabled: boolean;
  minSeverity: 'info' | 'low' | 'medium' | 'high' | 'critical';
  notifyEmails: string[];
  includeEvidenceSummary: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface NotificationHistoryRecord {
  id: string;
  workspaceId: string;
  alertId: string;
  alertTitle: string;
  alertSeverity: string;
  ruleName: string;
  recipientEmail: string;
  status: 'pending' | 'sent' | 'failed' | 'skipped';
  attempts: number;
  lastAttemptAt: string | null;
  sentAt: string | null;
  errorMessage: string | null;
  createdAt: string;
}

const SEVERITY_ORDER: Record<string, number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class AlertNotificationService {
  /**
   * Fetch notification preferences for a workspace, returning sensible defaults if unset.
   */
  public async getWorkspaceNotificationSettings(
    workspaceId: string
  ): Promise<WorkspaceNotificationSettings> {
    const res = await pool.query(
      `SELECT 
         id, workspace_id, enabled, min_severity, notify_emails,
         include_evidence_summary, created_at, updated_at
       FROM workspace_notification_settings
       WHERE workspace_id = $1`,
      [workspaceId]
    );

    if (res.rows.length === 0) {
      return {
        workspaceId,
        enabled: true,
        minSeverity: 'medium',
        notifyEmails: [],
        includeEvidenceSummary: true,
      };
    }

    const row = res.rows[0];
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      enabled: row.enabled,
      minSeverity: row.min_severity,
      notifyEmails: row.notify_emails || [],
      includeEvidenceSummary: row.include_evidence_summary,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Upsert notification settings for a workspace.
   */
  public async updateWorkspaceNotificationSettings(
    workspaceId: string,
    updates: {
      enabled?: boolean;
      minSeverity?: string;
      notifyEmails?: string[];
      includeEvidenceSummary?: boolean;
    }
  ): Promise<WorkspaceNotificationSettings> {
    // Validate minSeverity if provided
    if (updates.minSeverity !== undefined) {
      if (!Object.prototype.hasOwnProperty.call(SEVERITY_ORDER, updates.minSeverity)) {
        throw new Error(
          `VALIDATION_ERROR: Invalid minSeverity '${updates.minSeverity}'. Must be one of: info, low, medium, high, critical.`
        );
      }
    }

    // Validate email addresses if provided
    if (updates.notifyEmails !== undefined) {
      if (!Array.isArray(updates.notifyEmails)) {
        throw new Error('VALIDATION_ERROR: notifyEmails must be an array of email strings.');
      }
      for (const email of updates.notifyEmails) {
        if (typeof email !== 'string' || !EMAIL_REGEX.test(email.trim())) {
          throw new Error(`VALIDATION_ERROR: Invalid email address format: '${email}'`);
        }
      }
    }

    const current = await this.getWorkspaceNotificationSettings(workspaceId);

    const enabled = updates.enabled !== undefined ? updates.enabled : current.enabled;
    const minSeverity = updates.minSeverity !== undefined ? updates.minSeverity : current.minSeverity;
    const notifyEmails =
      updates.notifyEmails !== undefined
        ? updates.notifyEmails.map((e) => e.trim().toLowerCase())
        : current.notifyEmails;
    const includeEvidenceSummary =
      updates.includeEvidenceSummary !== undefined
        ? updates.includeEvidenceSummary
        : current.includeEvidenceSummary;

    const upsertQuery = `
      INSERT INTO workspace_notification_settings (
        workspace_id, enabled, min_severity, notify_emails, include_evidence_summary, updated_at
      ) VALUES ($1, $2, $3, $4, $5, NOW())
      ON CONFLICT (workspace_id) DO UPDATE
      SET enabled = EXCLUDED.enabled,
          min_severity = EXCLUDED.min_severity,
          notify_emails = EXCLUDED.notify_emails,
          include_evidence_summary = EXCLUDED.include_evidence_summary,
          updated_at = NOW()
      RETURNING id, workspace_id, enabled, min_severity, notify_emails, include_evidence_summary, created_at, updated_at;
    `;

    const res = await pool.query(upsertQuery, [
      workspaceId,
      enabled,
      minSeverity,
      notifyEmails,
      includeEvidenceSummary,
    ]);

    const row = res.rows[0];
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      enabled: row.enabled,
      minSeverity: row.min_severity,
      notifyEmails: row.notify_emails || [],
      includeEvidenceSummary: row.include_evidence_summary,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Asynchronously dispatches alert notifications based on workspace preferences.
   * Enforces deduplication via UNIQUE (alert_id, recipient_email) to prevent notification spam.
   */
  public async dispatchAlertNotifications(
    workspaceId: string,
    alertIds: string[]
  ): Promise<{ dispatched: number; skipped: number; errors: number }> {
    if (!alertIds || alertIds.length === 0) {
      return { dispatched: 0, skipped: 0, errors: 0 };
    }

    const settings = await this.getWorkspaceNotificationSettings(workspaceId);
    if (!settings.enabled || settings.notifyEmails.length === 0) {
      return { dispatched: 0, skipped: alertIds.length, errors: 0 };
    }

    const minSeverityThreshold = SEVERITY_ORDER[settings.minSeverity] ?? 2;

    // Fetch alerts to notify
    const alertsRes = await pool.query(
      `SELECT 
         a.id, a.rule_name, a.title, a.severity, a.summary,
         a.first_event_at, a.last_event_at, a.event_count,
         w.name AS workspace_name
       FROM alerts a
       JOIN workspaces w ON a.workspace_id = w.id
       WHERE a.id = ANY($1) AND a.workspace_id = $2`,
      [alertIds, workspaceId]
    );

    let dispatched = 0;
    let skipped = 0;
    let errors = 0;

    for (const alert of alertsRes.rows) {
      const alertSeverityLevel = SEVERITY_ORDER[alert.severity] ?? 0;
      if (alertSeverityLevel < minSeverityThreshold) {
        skipped++;
        continue;
      }

      for (const recipient of settings.notifyEmails) {
        const insertRes = await pool.query(
          `INSERT INTO alert_notifications (
             workspace_id, alert_id, recipient_email, status, attempts
           ) VALUES ($1, $2, $3, 'pending', 0)
           ON CONFLICT (alert_id, recipient_email) DO NOTHING
           RETURNING id`,
          [workspaceId, alert.id, recipient]
        );

        // If no row returned, notification already attempted or sent for this alert/recipient pair
        if (insertRes.rows.length === 0) {
          skipped++;
          continue;
        }

        const notificationId = insertRes.rows[0].id;
        const alertPayload: AlertEmailPayload = {
          id: alert.id,
          title: alert.title,
          ruleName: alert.rule_name,
          severity: alert.severity,
          summary: alert.summary,
          workspaceName: alert.workspace_name,
          eventCount: alert.event_count,
          occurredAt: alert.last_event_at || alert.first_event_at,
          evidenceSummary: settings.includeEvidenceSummary
            ? `${alert.event_count} supporting security events detected.`
            : undefined,
        };

        try {
          await emailService.sendAlertNotificationEmail(recipient, alertPayload);
          await pool.query(
            `UPDATE alert_notifications 
             SET status = 'sent', sent_at = NOW(), attempts = attempts + 1, last_attempt_at = NOW()
             WHERE id = $1`,
            [notificationId]
          );
          dispatched++;
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : String(err);
          logger.error({ err, notificationId, recipient, alertId: alert.id }, 'Alert email dispatch failed');
          await pool.query(
            `UPDATE alert_notifications 
             SET status = 'failed', error_message = $2, attempts = attempts + 1, last_attempt_at = NOW()
             WHERE id = $1`,
            [notificationId, errMsg.slice(0, 1024)]
          );
          errors++;
        }
      }
    }

    return { dispatched, skipped, errors };
  }

  /**
   * Retrieves notification delivery audit history for a workspace.
   */
  public async getNotificationHistory(
    workspaceId: string,
    limit = 50,
    offset = 0
  ): Promise<{ total: number; notifications: NotificationHistoryRecord[] }> {
    const countRes = await pool.query(
      `SELECT COUNT(*)::int AS total FROM alert_notifications WHERE workspace_id = $1`,
      [workspaceId]
    );
    const total = countRes.rows[0]?.total || 0;

    const rowsRes = await pool.query(
      `SELECT 
         an.id,
         an.workspace_id,
         an.alert_id,
         a.title AS alert_title,
         a.severity AS alert_severity,
         a.rule_name,
         an.recipient_email,
         an.status,
         an.attempts,
         an.last_attempt_at,
         an.sent_at,
         an.error_message,
         an.created_at
       FROM alert_notifications an
       JOIN alerts a ON an.alert_id = a.id
       WHERE an.workspace_id = $1
       ORDER BY an.created_at DESC
       LIMIT $2 OFFSET $3`,
      [workspaceId, limit, offset]
    );

    const notifications: NotificationHistoryRecord[] = rowsRes.rows.map((r) => ({
      id: r.id,
      workspaceId: r.workspace_id,
      alertId: r.alert_id,
      alertTitle: r.alert_title,
      alertSeverity: r.alert_severity,
      ruleName: r.rule_name,
      recipientEmail: r.recipient_email,
      status: r.status,
      attempts: r.attempts,
      lastAttemptAt: r.last_attempt_at,
      sentAt: r.sent_at,
      errorMessage: r.error_message,
      createdAt: r.created_at,
    }));

    return { total, notifications };
  }

  /**
   * Dispatches a test notification email to verify delivery channels.
   */
  public async sendTestNotification(
    workspaceId: string,
    recipientEmail: string
  ): Promise<boolean> {
    if (!EMAIL_REGEX.test(recipientEmail.trim())) {
      throw new Error(`VALIDATION_ERROR: Invalid email address: '${recipientEmail}'`);
    }

    const wsRes = await pool.query(`SELECT name FROM workspaces WHERE id = $1`, [workspaceId]);
    const workspaceName = wsRes.rows[0]?.name || 'NomaanOS Workspace';

    const testPayload: AlertEmailPayload = {
      id: '00000000-0000-0000-0000-000000000000',
      title: 'Test Security Alert Notification',
      ruleName: 'Test Notification Pipeline',
      severity: 'high',
      summary: 'This is a test notification from NomaanOS Sentinel verifying email alerting integration.',
      workspaceName,
      eventCount: 1,
      occurredAt: new Date().toISOString(),
      evidenceSummary: 'Notification pipeline verification check.',
    };

    return emailService.sendAlertNotificationEmail(recipientEmail.trim(), testPayload);
  }
}

export const alertNotificationService = new AlertNotificationService();

