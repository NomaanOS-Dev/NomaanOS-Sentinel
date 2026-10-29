import { Router, Request, Response, NextFunction } from 'express';
import { pool } from '../database/pool.js';
import { authenticate, requireWorkspaceMember, requireVerified } from '../middleware/auth.js';
import { logger } from '../config/logger.js';

export const alertsRouter = Router({ mergeParams: true });

// 1. List Alerts for Workspace
alertsRouter.get(
  '/',
  authenticate,
  requireWorkspaceMember('viewer'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceId = req.workspace!.id;
      const limit = Math.min(Math.max(parseInt((req.query.limit as string) || '50', 10), 1), 100);
      const page = parseInt(req.query.page as string, 10);
      const offset = (page && page > 0)
        ? (page - 1) * limit
        : Math.max(parseInt((req.query.offset as string) || '0', 10), 0);

      const severity = req.query.severity as string | undefined;
      const status = req.query.status as string | undefined;
      const ruleId = req.query.rule_id as string | undefined;
      const from = req.query.from as string | undefined;
      const to = req.query.to as string | undefined;

      const conditions: string[] = ['workspace_id = $1'];
      const params: (string | number)[] = [workspaceId];

      if (severity && severity !== 'all') {
        params.push(severity.toLowerCase());
        conditions.push(`severity = $${params.length}`);
      }

      if (status && status !== 'all') {
        params.push(status.toLowerCase());
        conditions.push(`status = $${params.length}`);
      }

      if (ruleId && ruleId !== 'all') {
        params.push(ruleId);
        conditions.push(`rule_id = $${params.length}`);
      }

      if (from) {
        const fromDate = new Date(from);
        if (isNaN(fromDate.getTime())) {
          res.status(400).json({ error: 'Validation Error', message: 'Invalid from timestamp.' });
          return;
        }
        params.push(fromDate.toISOString());
        conditions.push(`created_at >= $${params.length}`);
      }

      if (to) {
        const toDate = new Date(to);
        if (isNaN(toDate.getTime())) {
          res.status(400).json({ error: 'Validation Error', message: 'Invalid to timestamp.' });
          return;
        }
        params.push(toDate.toISOString());
        conditions.push(`created_at <= $${params.length}`);
      }

      const whereClause = conditions.join(' AND ');

      const dataQuery = `
        SELECT 
          id, workspace_id, dataset_id, rule_id, rule_version, rule_name,
          severity, status, title, summary, reason, fingerprint,
          first_event_at, last_event_at, event_count, metadata,
          created_at, updated_at
        FROM alerts
        WHERE ${whereClause}
        ORDER BY created_at DESC, id DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2};
      `;

      const countQuery = `
        SELECT COUNT(*)::int AS total 
        FROM alerts 
        WHERE ${whereClause};
      `;

      const [dataRes, countRes] = await Promise.all([
        pool.query(dataQuery, [...params, limit, offset]),
        pool.query(countQuery, params),
      ]);

      const alerts = dataRes.rows.map((row) => ({
        id: row.id,
        workspaceId: row.workspace_id,
        datasetId: row.dataset_id,
        ruleId: row.rule_id,
        ruleVersion: row.rule_version,
        ruleName: row.rule_name,
        severity: row.severity,
        status: row.status,
        title: row.title,
        summary: row.summary,
        reason: row.reason,
        fingerprint: row.fingerprint,
        firstEventAt: row.first_event_at,
        lastEventAt: row.last_event_at,
        eventCount: row.event_count,
        metadata: row.metadata,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }));

      const total = countRes.rows[0].total;

      res.status(200).json({
        status: 'ok',
        workspaceId,
        total,
        limit,
        offset,
        page: Math.floor(offset / limit) + 1,
        totalPages: Math.ceil(total / limit) || 1,
        alerts,
      });
    } catch (err) {
      next(err);
    }
  }
);

// 2. Get Single Alert Details with Linked Supporting Events
alertsRouter.get(
  '/:alertId',
  authenticate,
  requireWorkspaceMember('viewer'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceId = req.workspace!.id;
      const alertId = String(req.params.alertId);

      const alertQuery = `
        SELECT 
          id, workspace_id, dataset_id, rule_id, rule_version, rule_name,
          severity, status, title, summary, reason, fingerprint,
          first_event_at, last_event_at, event_count, metadata,
          created_at, updated_at
        FROM alerts
        WHERE id = $1 AND workspace_id = $2;
      `;

      const alertRes = await pool.query(alertQuery, [alertId, workspaceId]);
      if (alertRes.rows.length === 0) {
        res.status(404).json({ error: 'Not Found', message: 'Alert not found in this workspace.' });
        return;
      }

      const row = alertRes.rows[0];

      // Fetch linked supporting events
      const evidenceQuery = `
        SELECT 
          ae.role,
          se.id AS event_id,
          se.event_type,
          se.severity,
          se.occurred_at,
          se.username,
          se.source_ip,
          se.source_port,
          se.source_host,
          se.process_name,
          se.message,
          se.evidence
        FROM alert_events ae
        JOIN security_events se ON ae.event_id = se.id
        WHERE ae.alert_id = $1
        ORDER BY se.occurred_at ASC, se.id ASC;
      `;

      const evidenceRes = await pool.query(evidenceQuery, [alertId]);

      res.status(200).json({
        status: 'ok',
        alert: {
          id: row.id,
          workspaceId: row.workspace_id,
          datasetId: row.dataset_id,
          ruleId: row.rule_id,
          ruleVersion: row.rule_version,
          ruleName: row.rule_name,
          severity: row.severity,
          status: row.status,
          title: row.title,
          summary: row.summary,
          reason: row.reason,
          fingerprint: row.fingerprint,
          firstEventAt: row.first_event_at,
          lastEventAt: row.last_event_at,
          eventCount: row.event_count,
          metadata: row.metadata,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          evidenceEvents: evidenceRes.rows.map((e) => ({
            role: e.role,
            eventId: e.event_id,
            eventType: e.event_type,
            severity: e.severity,
            occurredAt: e.occurred_at,
            username: e.username,
            sourceIp: e.source_ip,
            sourcePort: e.source_port,
            sourceHost: e.source_host,
            processName: e.process_name,
            message: e.message,
            evidence: e.evidence,
          })),
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// 3. Update Alert Status (analyst or admin)
alertsRouter.patch(
  '/:alertId/status',
  authenticate,
  requireVerified,
  requireWorkspaceMember('analyst'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceId = req.workspace!.id;
      const alertId = String(req.params.alertId);
      const { status } = req.body;

      const validStatuses = ['open', 'acknowledged', 'resolved', 'dismissed'];
      if (!status || !validStatuses.includes(status)) {
        res.status(400).json({
          error: 'Validation Error',
          message: `Invalid status '${status}'. Allowed statuses: ${validStatuses.join(', ')}.`,
        });
        return;
      }

      const updateRes = await pool.query(
        `UPDATE alerts
         SET status = $1, updated_at = NOW()
         WHERE id = $2 AND workspace_id = $3
         RETURNING id, status, updated_at;`,
        [status, alertId, workspaceId]
      );

      if (updateRes.rows.length === 0) {
        res.status(404).json({ error: 'Not Found', message: 'Alert not found in this workspace.' });
        return;
      }

      logger.info({ alertId, workspaceId, newStatus: status, userId: req.user!.id }, 'Updated alert status');

      res.status(200).json({
        status: 'ok',
        message: `Alert status updated to '${status}'.`,
        alert: updateRes.rows[0],
      });
    } catch (err) {
      next(err);
    }
  }
);

