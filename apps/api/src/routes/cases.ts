import { Router, Request, Response, NextFunction } from 'express';
import { pool } from '../database/pool.js';
import { authenticate, requireWorkspaceMember, requireVerified, isRoleSufficient } from '../middleware/auth.js';
import { aiInvestigationRateLimiter } from '../middleware/rate-limiter.js';
import { runAiInvestigation, getLatestAiInvestigation } from '../services/ai-investigator.js';
import { AiProviderError } from '../services/ai-provider.js';
import { billingService } from '../services/billing-service.js';
import { logger } from '../config/logger.js';

export const casesRouter = Router({ mergeParams: true });

const ALLOWED_STATUSES = ['open', 'in_progress', 'escalated', 'closed'] as const;
type CaseStatus = typeof ALLOWED_STATUSES[number];

const ALLOWED_PRIORITIES = ['low', 'medium', 'high', 'critical'] as const;
type CasePriority = typeof ALLOWED_PRIORITIES[number];

// Status Transition State Machine Rules
const VALID_STATUS_TRANSITIONS: Record<CaseStatus, CaseStatus[]> = {
  open: ['in_progress', 'escalated', 'closed'],
  in_progress: ['open', 'escalated', 'closed'],
  escalated: ['in_progress', 'closed'],
  closed: ['open', 'in_progress'],
};

// 1. List Cases for Workspace (Paginated, Filterable by status/priority/assignee)
casesRouter.get(
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

      const status = req.query.status as string | undefined;
      const priority = req.query.priority as string | undefined;
      const assigneeId = req.query.assignee_id as string | undefined;

      const conditions: string[] = ['c.workspace_id = $1'];
      const params: (string | number)[] = [workspaceId];

      if (status && status !== 'all') {
        params.push(status.toLowerCase());
        conditions.push(`c.status = $${params.length}`);
      }

      if (priority && priority !== 'all') {
        params.push(priority.toLowerCase());
        conditions.push(`c.priority = $${params.length}`);
      }

      if (assigneeId && assigneeId !== 'all') {
        params.push(assigneeId);
        conditions.push(`c.assignee_id = $${params.length}`);
      }

      const whereClause = conditions.join(' AND ');

      const dataQuery = `
        SELECT 
          c.id, c.workspace_id, c.title, c.description, c.status, c.priority,
          c.assignee_id, c.created_by, c.source_alert_id, c.idempotency_key,
          c.created_at, c.updated_at, c.closed_at,
          u_assignee.email AS assignee_email,
          u_assignee.full_name AS assignee_name,
          u_creator.email AS creator_email,
          u_creator.full_name AS creator_name,
          COALESCE(alert_counts.total_alerts, 0)::int AS alert_count,
          COALESCE(note_counts.total_notes, 0)::int AS note_count
        FROM cases c
        LEFT JOIN users u_assignee ON c.assignee_id = u_assignee.id
        LEFT JOIN users u_creator ON c.created_by = u_creator.id
        LEFT JOIN (
          SELECT case_id, COUNT(*)::int AS total_alerts
          FROM case_alerts
          WHERE workspace_id = $1
          GROUP BY case_id
        ) alert_counts ON c.id = alert_counts.case_id
        LEFT JOIN (
          SELECT case_id, COUNT(*)::int AS total_notes
          FROM case_notes
          WHERE workspace_id = $1
          GROUP BY case_id
        ) note_counts ON c.id = note_counts.case_id
        WHERE ${whereClause}
        ORDER BY c.created_at DESC, c.id DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2};
      `;

      const countQuery = `
        SELECT COUNT(*)::int AS total 
        FROM cases c
        WHERE ${whereClause};
      `;

      const [dataRes, countRes] = await Promise.all([
        pool.query(dataQuery, [...params, limit, offset]),
        pool.query(countQuery, params),
      ]);

      const cases = dataRes.rows.map((row) => ({
        id: row.id,
        workspaceId: row.workspace_id,
        title: row.title,
        description: row.description,
        status: row.status,
        priority: row.priority,
        assigneeId: row.assignee_id,
        assignee: row.assignee_id ? {
          id: row.assignee_id,
          email: row.assignee_email,
          fullName: row.assignee_name,
        } : null,
        createdBy: {
          id: row.created_by,
          email: row.creator_email,
          fullName: row.creator_name,
        },
        sourceAlertId: row.source_alert_id,
        alertCount: row.alert_count,
        noteCount: row.note_count,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        closedAt: row.closed_at,
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
        cases,
      });
    } catch (err) {
      next(err);
    }
  }
);

// 2. Create Investigation Case (Optionally from source alert, idempotent)
casesRouter.post(
  '/',
  authenticate,
  requireVerified,
  requireWorkspaceMember('analyst'),
  async (req: Request, res: Response, next: NextFunction) => {
    const client = await pool.connect();
    try {
      const workspaceId = req.workspace!.id;
      const userId = req.user!.id;
      let { title, description, priority, status, assigneeId, alertId, alertIds, idempotencyKey } = req.body;

      // 1. Idempotency Check: prevent duplicate case creation from double-clicks or retries
      if (idempotencyKey && typeof idempotencyKey === 'string' && idempotencyKey.trim().length > 0) {
        idempotencyKey = idempotencyKey.trim();
        const existingRes = await client.query(
          `SELECT id, workspace_id, title, status, priority, created_at FROM cases WHERE workspace_id = $1 AND idempotency_key = $2`,
          [workspaceId, idempotencyKey]
        );
        if (existingRes.rows.length > 0) {
          logger.info({ workspaceId, caseId: existingRes.rows[0].id, idempotencyKey }, 'Returning existing case for idempotencyKey');
          res.status(200).json({
            status: 'ok',
            message: 'Existing case returned for this idempotency key.',
            case: existingRes.rows[0],
          });
          return;
        }
      } else {
        idempotencyKey = null;
      }

      // 2. Resolve source alert and populate defaults if created from an alert
      let sourceAlert: any = null;
      if (alertId) {
        const alertRes = await client.query(
          `SELECT id, workspace_id, title, summary, severity, rule_id, rule_version, fingerprint 
           FROM alerts WHERE id = $1 AND workspace_id = $2`,
          [alertId, workspaceId]
        );
        if (alertRes.rows.length === 0) {
          res.status(404).json({ error: 'Not Found', message: 'Source alert not found in this workspace.' });
          return;
        }
        sourceAlert = alertRes.rows[0];

        if (!title || typeof title !== 'string' || title.trim().length === 0) {
          title = `Investigation: ${sourceAlert.title}`;
        }
        if (!description || typeof description !== 'string') {
          description = `Automated detection investigation for ${sourceAlert.rule_id} (v${sourceAlert.rule_version}).\n\nAlert Summary:\n${sourceAlert.summary}`;
        }
        if (!priority) {
          priority = (['critical', 'high', 'medium', 'low'].includes(sourceAlert.severity))
            ? sourceAlert.severity
            : 'medium';
        }
      }

      // 3. Validate Case Title
      if (!title || typeof title !== 'string' || title.trim().length === 0) {
        res.status(400).json({ error: 'Validation Error', message: 'Case title is required.' });
        return;
      }
      const trimmedTitle = title.trim();
      if (trimmedTitle.length > 255) {
        res.status(400).json({ error: 'Validation Error', message: 'Case title cannot exceed 255 characters.' });
        return;
      }

      // 4. Validate Priority
      const resolvedPriority = (priority && ALLOWED_PRIORITIES.includes(priority.toLowerCase() as any))
        ? priority.toLowerCase()
        : 'medium';

      // 5. Validate Initial Status
      const resolvedStatus = (status && ALLOWED_STATUSES.includes(status.toLowerCase() as any))
        ? status.toLowerCase()
        : 'open';

      // 6. Validate Assignee if provided
      if (assigneeId) {
        const memberRes = await client.query(
          `SELECT user_id FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2`,
          [workspaceId, assigneeId]
        );
        if (memberRes.rows.length === 0) {
          res.status(400).json({ error: 'Validation Error', message: 'Assigned user is not a member of this workspace.' });
          return;
        }
      } else {
        assigneeId = null;
      }

      await client.query('BEGIN');

      // 7. Insert Case record
      const caseRes = await client.query(
        `INSERT INTO cases (
          workspace_id, title, description, status, priority, assignee_id, created_by, source_alert_id, idempotency_key
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *;`,
        [
          workspaceId,
          trimmedTitle,
          description || '',
          resolvedStatus,
          resolvedPriority,
          assigneeId,
          userId,
          sourceAlert ? sourceAlert.id : null,
          idempotencyKey,
        ]
      );
      const newCase = caseRes.rows[0];

      // 8. Link Alerts
      const alertsToLink = new Set<string>();
      if (sourceAlert) {
        alertsToLink.add(sourceAlert.id);
      }
      if (Array.isArray(alertIds)) {
        for (const aid of alertIds) {
          if (typeof aid === 'string') alertsToLink.add(aid);
        }
      }

      for (const aid of alertsToLink) {
        const checkAlert = await client.query(
          `SELECT id, title, rule_id FROM alerts WHERE id = $1 AND workspace_id = $2`,
          [aid, workspaceId]
        );
        if (checkAlert.rows.length > 0) {
          await client.query(
            `INSERT INTO case_alerts (case_id, alert_id, workspace_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
            [newCase.id, aid, workspaceId]
          );
          await client.query(
            `INSERT INTO case_audit_logs (case_id, workspace_id, actor_id, action, details)
             VALUES ($1, $2, $3, 'alert_linked', $4)`,
            [
              newCase.id,
              workspaceId,
              userId,
              JSON.stringify({
                alertId: aid,
                alertTitle: checkAlert.rows[0].title,
                ruleId: checkAlert.rows[0].rule_id,
              }),
            ]
          );
        }
      }

      // 9. Record case creation in audit log
      await client.query(
        `INSERT INTO case_audit_logs (case_id, workspace_id, actor_id, action, details)
         VALUES ($1, $2, $3, 'case_created', $4)`,
        [
          newCase.id,
          workspaceId,
          userId,
          JSON.stringify({
            title: newCase.title,
            priority: newCase.priority,
            status: newCase.status,
            assigneeId: newCase.assignee_id,
            sourceAlertId: newCase.source_alert_id,
            linkedAlertCount: alertsToLink.size,
          }),
        ]
      );

      await client.query('COMMIT');

      logger.info({ workspaceId, caseId: newCase.id, userId, title: newCase.title }, 'Investigation case created successfully');

      res.status(201).json({
        status: 'ok',
        message: 'Investigation case created successfully.',
        case: newCase,
      });
    } catch (err: any) {
      await client.query('ROLLBACK');
      // If unique constraint on idempotency_key failed under concurrent race condition
      if (err.code === '23505' && err.constraint === 'uq_cases_workspace_idempotency') {
        const existing = await pool.query(
          `SELECT * FROM cases WHERE workspace_id = $1 AND idempotency_key = $2`,
          [req.workspace!.id, req.body.idempotencyKey]
        );
        if (existing.rows.length > 0) {
          res.status(200).json({
            status: 'ok',
            message: 'Existing case returned for this idempotency key.',
            case: existing.rows[0],
          });
          return;
        }
      }
      next(err);
    } finally {
      client.release();
    }
  }
);

// 3. Get Single Case Details with Linked Alerts, Evidence Events, Notes, and Audit History
casesRouter.get(
  '/:caseId',
  authenticate,
  requireWorkspaceMember('viewer'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceId = req.workspace!.id;
      const caseId = String(req.params.caseId);

      // Fetch case
      const caseQuery = `
        SELECT 
          c.id, c.workspace_id, c.title, c.description, c.status, c.priority,
          c.assignee_id, c.created_by, c.source_alert_id, c.idempotency_key,
          c.created_at, c.updated_at, c.closed_at,
          u_assignee.email AS assignee_email,
          u_assignee.full_name AS assignee_name,
          u_creator.email AS creator_email,
          u_creator.full_name AS creator_name
        FROM cases c
        LEFT JOIN users u_assignee ON c.assignee_id = u_assignee.id
        LEFT JOIN users u_creator ON c.created_by = u_creator.id
        WHERE c.id = $1 AND c.workspace_id = $2;
      `;

      const caseRes = await pool.query(caseQuery, [caseId, workspaceId]);
      if (caseRes.rows.length === 0) {
        res.status(404).json({ error: 'Not Found', message: 'Investigation case not found in this workspace.' });
        return;
      }
      const c = caseRes.rows[0];

      // Fetch linked alerts
      const alertsQuery = `
        SELECT 
          a.id, a.workspace_id, a.dataset_id, a.rule_id, a.rule_version, a.rule_name,
          a.severity, a.status, a.title, a.summary, a.reason, a.fingerprint,
          a.first_event_at, a.last_event_at, a.event_count, a.metadata,
          a.created_at, a.updated_at,
          ca.created_at AS linked_at
        FROM alerts a
        JOIN case_alerts ca ON a.id = ca.alert_id
        WHERE ca.case_id = $1 AND ca.workspace_id = $2
        ORDER BY a.created_at DESC;
      `;

      // Fetch supporting events for linked alerts
      const eventsQuery = `
        SELECT 
          se.id AS event_id,
          se.schema_version,
          se.tenant_id,
          se.dataset_id,
          se.source_type,
          se.source_host,
          se.event_type,
          se.severity,
          se.occurred_at,
          se.username,
          se.source_ip,
          se.source_port,
          se.process_name,
          se.message,
          se.evidence,
          ae.alert_id,
          ae.role
        FROM security_events se
        JOIN alert_events ae ON se.id = ae.event_id
        JOIN case_alerts ca ON ae.alert_id = ca.alert_id
        WHERE ca.case_id = $1 AND ca.workspace_id = $2
        ORDER BY se.occurred_at ASC, se.id ASC;
      `;

      // Fetch notes
      const notesQuery = `
        SELECT 
          cn.id, cn.case_id, cn.workspace_id, cn.author_id, cn.content,
          cn.created_at, cn.updated_at,
          u.email AS author_email,
          u.full_name AS author_name
        FROM case_notes cn
        JOIN users u ON cn.author_id = u.id
        WHERE cn.case_id = $1 AND cn.workspace_id = $2
        ORDER BY cn.created_at ASC;
      `;

      // Fetch audit logs
      const auditQuery = `
        SELECT 
          cal.id, cal.case_id, cal.workspace_id, cal.actor_id, cal.action,
          cal.details, cal.created_at,
          u.email AS actor_email,
          u.full_name AS actor_name
        FROM case_audit_logs cal
        JOIN users u ON cal.actor_id = u.id
        WHERE cal.case_id = $1 AND cal.workspace_id = $2
        ORDER BY cal.created_at ASC;
      `;

      const [alertsRes, eventsRes, notesRes, auditRes] = await Promise.all([
        pool.query(alertsQuery, [caseId, workspaceId]),
        pool.query(eventsQuery, [caseId, workspaceId]),
        pool.query(notesQuery, [caseId, workspaceId]),
        pool.query(auditQuery, [caseId, workspaceId]),
      ]);

      res.status(200).json({
        status: 'ok',
        workspaceId,
        case: {
          id: c.id,
          workspaceId: c.workspace_id,
          title: c.title,
          description: c.description,
          status: c.status,
          priority: c.priority,
          assigneeId: c.assignee_id,
          assignee: c.assignee_id ? {
            id: c.assignee_id,
            email: c.assignee_email,
            fullName: c.assignee_name,
          } : null,
          createdBy: {
            id: c.created_by,
            email: c.creator_email,
            fullName: c.creator_name,
          },
          sourceAlertId: c.source_alert_id,
          createdAt: c.created_at,
          updatedAt: c.updated_at,
          closedAt: c.closed_at,
          linkedAlerts: alertsRes.rows.map((row) => ({
            id: row.id,
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
            linkedAt: row.linked_at,
          })),
          supportingEvents: eventsRes.rows.map((row) => ({
            eventId: row.event_id,
            alertId: row.alert_id,
            role: row.role,
            eventType: row.event_type,
            severity: row.severity,
            occurredAt: row.occurred_at,
            username: row.username,
            sourceIp: row.source_ip,
            sourcePort: row.source_port,
            sourceHost: row.source_host,
            processName: row.process_name,
            message: row.message,
            evidence: row.evidence,
          })),
          notes: notesRes.rows.map((row) => ({
            id: row.id,
            caseId: row.case_id,
            authorId: row.author_id,
            author: {
              id: row.author_id,
              email: row.author_email,
              fullName: row.author_name,
            },
            content: row.content,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
          })),
          auditHistory: auditRes.rows.map((row) => ({
            id: row.id,
            action: row.action,
            details: row.details,
            createdAt: row.created_at,
            actor: {
              id: row.actor_id,
              email: row.actor_email,
              fullName: row.actor_name,
            },
          })),
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// 4. Update Case Status (Analyst/Admin/Owner, validates state transition)
casesRouter.patch(
  '/:caseId/status',
  authenticate,
  requireVerified,
  requireWorkspaceMember('analyst'),
  async (req: Request, res: Response, next: NextFunction) => {
    const client = await pool.connect();
    try {
      const workspaceId = req.workspace!.id;
      const caseId = String(req.params.caseId);
      const userId = req.user!.id;
      const { status } = req.body;

      if (!status || !ALLOWED_STATUSES.includes(status.toLowerCase() as any)) {
        res.status(400).json({
          error: 'Validation Error',
          message: `Invalid status '${status}'. Allowed statuses: ${ALLOWED_STATUSES.join(', ')}.`,
        });
        return;
      }

      const targetStatus = status.toLowerCase() as CaseStatus;

      await client.query('BEGIN');

      const currentRes = await client.query(
        `SELECT id, status, closed_at FROM cases WHERE id = $1 AND workspace_id = $2 FOR UPDATE`,
        [caseId, workspaceId]
      );

      if (currentRes.rows.length === 0) {
        await client.query('ROLLBACK');
        res.status(404).json({ error: 'Not Found', message: 'Case not found in this workspace.' });
        return;
      }

      const currentStatus = currentRes.rows[0].status as CaseStatus;

      // Idempotent: same status is no-op
      if (currentStatus === targetStatus) {
        await client.query('ROLLBACK');
        res.status(200).json({
          status: 'ok',
          message: `Case is already in status '${targetStatus}'.`,
          case: currentRes.rows[0],
        });
        return;
      }

      // Check transition rules
      const validNextStatuses = VALID_STATUS_TRANSITIONS[currentStatus];
      if (!validNextStatuses || !validNextStatuses.includes(targetStatus)) {
        await client.query('ROLLBACK');
        res.status(400).json({
          error: 'Invalid Transition',
          message: `Cannot transition case status from '${currentStatus}' to '${targetStatus}'. Allowed transitions from '${currentStatus}': ${validNextStatuses.join(', ')}.`,
        });
        return;
      }

      const isClosing = targetStatus === 'closed';
      const updateRes = await client.query(
        `UPDATE cases
         SET status = $1,
             closed_at = CASE WHEN $2 = TRUE THEN NOW() ELSE NULL END,
             updated_at = NOW()
         WHERE id = $3 AND workspace_id = $4
         RETURNING *;`,
        [targetStatus, isClosing, caseId, workspaceId]
      );

      // Record audit history entry
      await client.query(
        `INSERT INTO case_audit_logs (case_id, workspace_id, actor_id, action, details)
         VALUES ($1, $2, $3, 'status_changed', $4);`,
        [
          caseId,
          workspaceId,
          userId,
          JSON.stringify({
            previousStatus: currentStatus,
            newStatus: targetStatus,
          }),
        ]
      );

      await client.query('COMMIT');

      logger.info({ workspaceId, caseId, userId, previousStatus: currentStatus, newStatus: targetStatus }, 'Case status transitioned');

      res.status(200).json({
        status: 'ok',
        message: `Case status changed to '${targetStatus}'.`,
        case: updateRes.rows[0],
      });
    } catch (err) {
      await client.query('ROLLBACK');
      next(err);
    } finally {
      client.release();
    }
  }
);

// 5. Update Case Assignment (Analyst/Admin/Owner)
casesRouter.patch(
  '/:caseId/assignee',
  authenticate,
  requireVerified,
  requireWorkspaceMember('analyst'),
  async (req: Request, res: Response, next: NextFunction) => {
    const client = await pool.connect();
    try {
      const workspaceId = req.workspace!.id;
      const caseId = String(req.params.caseId);
      const userId = req.user!.id;
      const { assigneeId } = req.body;

      let newAssigneeUser: any = null;
      if (assigneeId !== null && assigneeId !== undefined && assigneeId !== '') {
        const memberRes = await client.query(
          `SELECT u.id, u.email, u.full_name
           FROM workspace_memberships wm
           JOIN users u ON wm.user_id = u.id
           WHERE wm.workspace_id = $1 AND wm.user_id = $2;`,
          [workspaceId, assigneeId]
        );
        if (memberRes.rows.length === 0) {
          res.status(400).json({
            error: 'Validation Error',
            message: 'Assigned user is not an active member of this workspace.',
          });
          return;
        }
        newAssigneeUser = memberRes.rows[0];
      }

      await client.query('BEGIN');

      const currentRes = await client.query(
        `SELECT id, assignee_id FROM cases WHERE id = $1 AND workspace_id = $2 FOR UPDATE`,
        [caseId, workspaceId]
      );

      if (currentRes.rows.length === 0) {
        await client.query('ROLLBACK');
        res.status(404).json({ error: 'Not Found', message: 'Case not found in this workspace.' });
        return;
      }

      const previousAssigneeId = currentRes.rows[0].assignee_id;
      const resolvedAssigneeId = newAssigneeUser ? newAssigneeUser.id : null;

      const updateRes = await client.query(
        `UPDATE cases
         SET assignee_id = $1, updated_at = NOW()
         WHERE id = $2 AND workspace_id = $3
         RETURNING *;`,
        [resolvedAssigneeId, caseId, workspaceId]
      );

      // Record audit history entry
      await client.query(
        `INSERT INTO case_audit_logs (case_id, workspace_id, actor_id, action, details)
         VALUES ($1, $2, $3, 'assignee_changed', $4);`,
        [
          caseId,
          workspaceId,
          userId,
          JSON.stringify({
            previousAssigneeId,
            newAssigneeId: resolvedAssigneeId,
            newAssigneeName: newAssigneeUser ? (newAssigneeUser.full_name || newAssigneeUser.email) : 'Unassigned',
          }),
        ]
      );

      await client.query('COMMIT');

      logger.info({ workspaceId, caseId, userId, previousAssigneeId, newAssigneeId: resolvedAssigneeId }, 'Case assignee updated');

      res.status(200).json({
        status: 'ok',
        message: resolvedAssigneeId ? 'Case assigned successfully.' : 'Case unassigned.',
        case: updateRes.rows[0],
      });
    } catch (err) {
      await client.query('ROLLBACK');
      next(err);
    } finally {
      client.release();
    }
  }
);

// 6. Add Investigation Note (Analyst/Admin/Owner, max 10,000 characters)
casesRouter.post(
  '/:caseId/notes',
  authenticate,
  requireVerified,
  requireWorkspaceMember('analyst'),
  async (req: Request, res: Response, next: NextFunction) => {
    const client = await pool.connect();
    try {
      const workspaceId = req.workspace!.id;
      const caseId = String(req.params.caseId);
      const userId = req.user!.id;
      const { content } = req.body;

      if (!content || typeof content !== 'string' || content.trim().length === 0) {
        res.status(400).json({ error: 'Validation Error', message: 'Note content cannot be empty.' });
        return;
      }

      if (content.length > 10000) {
        res.status(400).json({
          error: 'Validation Error',
          message: `Note content exceeds maximum permitted length of 10,000 characters (provided: ${content.length}).`,
        });
        return;
      }

      await client.query('BEGIN');

      // Verify case exists
      const caseRes = await client.query(
        `SELECT id FROM cases WHERE id = $1 AND workspace_id = $2 FOR UPDATE`,
        [caseId, workspaceId]
      );
      if (caseRes.rows.length === 0) {
        await client.query('ROLLBACK');
        res.status(404).json({ error: 'Not Found', message: 'Case not found in this workspace.' });
        return;
      }

      const noteRes = await client.query(
        `INSERT INTO case_notes (case_id, workspace_id, author_id, content)
         VALUES ($1, $2, $3, $4)
         RETURNING *;`,
        [caseId, workspaceId, userId, content.trim()]
      );

      await client.query(
        `UPDATE cases SET updated_at = NOW() WHERE id = $1 AND workspace_id = $2`,
        [caseId, workspaceId]
      );

      // Audit history
      await client.query(
        `INSERT INTO case_audit_logs (case_id, workspace_id, actor_id, action, details)
         VALUES ($1, $2, $3, 'note_added', $4);`,
        [
          caseId,
          workspaceId,
          userId,
          JSON.stringify({
            noteId: noteRes.rows[0].id,
            characterCount: content.trim().length,
          }),
        ]
      );

      await client.query('COMMIT');

      // Hydrate author details for response
      const authorRes = await pool.query(
        `SELECT id, email, full_name FROM users WHERE id = $1`,
        [userId]
      );

      res.status(201).json({
        status: 'ok',
        message: 'Investigation note added successfully.',
        note: {
          ...noteRes.rows[0],
          author: authorRes.rows[0] || { id: userId },
        },
      });
    } catch (err) {
      await client.query('ROLLBACK');
      next(err);
    } finally {
      client.release();
    }
  }
);

// 7. Delete Investigation Note (Author or Admin/Owner)
casesRouter.delete(
  '/:caseId/notes/:noteId',
  authenticate,
  requireVerified,
  requireWorkspaceMember('analyst'),
  async (req: Request, res: Response, next: NextFunction) => {
    const client = await pool.connect();
    try {
      const workspaceId = req.workspace!.id;
      const caseId = String(req.params.caseId);
      const noteId = String(req.params.noteId);
      const userId = req.user!.id;
      const userRole = req.membership!.role;

      await client.query('BEGIN');

      const noteRes = await client.query(
        `SELECT id, author_id FROM case_notes WHERE id = $1 AND case_id = $2 AND workspace_id = $3 FOR UPDATE`,
        [noteId, caseId, workspaceId]
      );

      if (noteRes.rows.length === 0) {
        await client.query('ROLLBACK');
        res.status(404).json({ error: 'Not Found', message: 'Note not found in this case.' });
        return;
      }

      // Check permission: author or manager (admin/owner)
      const isAuthor = noteRes.rows[0].author_id === userId;
      const isManager = isRoleSufficient(userRole, 'admin');

      if (!isAuthor && !isManager) {
        await client.query('ROLLBACK');
        res.status(403).json({ error: 'Forbidden', message: 'You can only delete your own notes unless you are an Admin or Owner.' });
        return;
      }

      await client.query(
        `DELETE FROM case_notes WHERE id = $1 AND case_id = $2 AND workspace_id = $3`,
        [noteId, caseId, workspaceId]
      );

      await client.query(
        `INSERT INTO case_audit_logs (case_id, workspace_id, actor_id, action, details)
         VALUES ($1, $2, $3, 'note_deleted', $4);`,
        [caseId, workspaceId, userId, JSON.stringify({ noteId })]
      );

      await client.query('COMMIT');

      res.status(200).json({ status: 'ok', message: 'Note deleted successfully.' });
    } catch (err) {
      await client.query('ROLLBACK');
      next(err);
    } finally {
      client.release();
    }
  }
);

// 8. Link Additional Alert to Case (Analyst/Admin/Owner)
casesRouter.post(
  '/:caseId/alerts',
  authenticate,
  requireVerified,
  requireWorkspaceMember('analyst'),
  async (req: Request, res: Response, next: NextFunction) => {
    const client = await pool.connect();
    try {
      const workspaceId = req.workspace!.id;
      const caseId = String(req.params.caseId);
      const userId = req.user!.id;
      const { alertId } = req.body;

      if (!alertId || typeof alertId !== 'string') {
        res.status(400).json({ error: 'Validation Error', message: 'A valid alertId is required.' });
        return;
      }

      await client.query('BEGIN');

      // Verify case exists
      const caseRes = await client.query(
        `SELECT id FROM cases WHERE id = $1 AND workspace_id = $2 FOR UPDATE`,
        [caseId, workspaceId]
      );
      if (caseRes.rows.length === 0) {
        await client.query('ROLLBACK');
        res.status(404).json({ error: 'Not Found', message: 'Case not found in this workspace.' });
        return;
      }

      // Verify alert belongs to this workspace
      const alertRes = await client.query(
        `SELECT id, title, rule_id, rule_version FROM alerts WHERE id = $1 AND workspace_id = $2`,
        [alertId, workspaceId]
      );
      if (alertRes.rows.length === 0) {
        await client.query('ROLLBACK');
        res.status(404).json({ error: 'Not Found', message: 'Alert not found in this workspace.' });
        return;
      }

      const alert = alertRes.rows[0];

      await client.query(
        `INSERT INTO case_alerts (case_id, alert_id, workspace_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (case_id, alert_id) DO NOTHING;`,
        [caseId, alertId, workspaceId]
      );

      await client.query(
        `UPDATE cases SET updated_at = NOW() WHERE id = $1 AND workspace_id = $2`,
        [caseId, workspaceId]
      );

      await client.query(
        `INSERT INTO case_audit_logs (case_id, workspace_id, actor_id, action, details)
         VALUES ($1, $2, $3, 'alert_linked', $4);`,
        [
          caseId,
          workspaceId,
          userId,
          JSON.stringify({
            alertId: alert.id,
            alertTitle: alert.title,
            ruleId: alert.rule_id,
            ruleVersion: alert.rule_version,
          }),
        ]
      );

      await client.query('COMMIT');

      res.status(200).json({
        status: 'ok',
        message: 'Alert linked to case successfully.',
        alertId: alert.id,
      });
    } catch (err) {
      await client.query('ROLLBACK');
      next(err);
    } finally {
      client.release();
    }
  }
);

// 9. Export Structured Investigation Report (JSON format, grounded in persisted case & evidence data)
casesRouter.get(
  '/:caseId/export',
  authenticate,
  requireWorkspaceMember('viewer'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceId = req.workspace!.id;
      const caseId = String(req.params.caseId);
      const userId = req.user!.id;
      const format = (req.query.format as string || 'json').toLowerCase();

      if (format !== 'json') {
        res.status(400).json({
          error: 'Validation Error',
          message: `Unsupported export format '${format}'. Supported formats: json.`,
        });
        return;
      }

      // 1. Fetch Case with Creator and Assignee
      const caseQuery = `
        SELECT 
          c.id, c.workspace_id, c.title, c.description, c.status, c.priority,
          c.assignee_id, c.created_by, c.source_alert_id, c.created_at, c.updated_at, c.closed_at,
          w.name AS workspace_name,
          u_assignee.email AS assignee_email,
          u_assignee.full_name AS assignee_name,
          u_creator.email AS creator_email,
          u_creator.full_name AS creator_name
        FROM cases c
        JOIN workspaces w ON c.workspace_id = w.id
        LEFT JOIN users u_assignee ON c.assignee_id = u_assignee.id
        LEFT JOIN users u_creator ON c.created_by = u_creator.id
        WHERE c.id = $1 AND c.workspace_id = $2;
      `;
      const caseRes = await pool.query(caseQuery, [caseId, workspaceId]);
      if (caseRes.rows.length === 0) {
        res.status(404).json({ error: 'Not Found', message: 'Case not found in this workspace.' });
        return;
      }
      const c = caseRes.rows[0];

      // 2. Fetch Linked Alerts
      const alertsQuery = `
        SELECT 
          a.id, a.workspace_id, a.dataset_id, a.rule_id, a.rule_version, a.rule_name,
          a.severity, a.status, a.title, a.summary, a.reason, a.fingerprint,
          a.first_event_at, a.last_event_at, a.event_count, a.metadata,
          a.created_at, a.updated_at, ca.created_at AS linked_at
        FROM alerts a
        JOIN case_alerts ca ON a.id = ca.alert_id
        WHERE ca.case_id = $1 AND ca.workspace_id = $2
        ORDER BY a.created_at DESC;
      `;

      // 3. Fetch Supporting Evidence Events
      const eventsQuery = `
        SELECT 
          se.id AS event_id,
          se.schema_version,
          se.tenant_id,
          se.dataset_id,
          se.source_type,
          se.source_host,
          se.event_type,
          se.severity,
          se.occurred_at,
          se.username,
          HOST(se.source_ip) AS source_ip,
          se.source_port,
          se.process_name,
          se.message,
          se.evidence,
          ae.alert_id,
          ae.role
        FROM security_events se
        JOIN alert_events ae ON se.id = ae.event_id
        JOIN case_alerts ca ON ae.alert_id = ca.alert_id
        WHERE ca.case_id = $1 AND ca.workspace_id = $2
        ORDER BY se.occurred_at ASC, se.id ASC;
      `;

      // 4. Fetch Notes
      const notesQuery = `
        SELECT 
          cn.id, cn.author_id, cn.content, cn.created_at, cn.updated_at,
          u.email AS author_email, u.full_name AS author_name
        FROM case_notes cn
        JOIN users u ON cn.author_id = u.id
        WHERE cn.case_id = $1 AND cn.workspace_id = $2
        ORDER BY cn.created_at ASC;
      `;

      // 5. Fetch Audit History Timeline
      const auditQuery = `
        SELECT 
          cal.id, cal.action, cal.details, cal.created_at,
          u.email AS actor_email, u.full_name AS actor_name
        FROM case_audit_logs cal
        JOIN users u ON cal.actor_id = u.id
        WHERE cal.case_id = $1 AND cal.workspace_id = $2
        ORDER BY cal.created_at ASC;
      `;

      const [alertsRes, eventsRes, notesRes, auditRes] = await Promise.all([
        pool.query(alertsQuery, [caseId, workspaceId]),
        pool.query(eventsQuery, [caseId, workspaceId]),
        pool.query(notesQuery, [caseId, workspaceId]),
        pool.query(auditQuery, [caseId, workspaceId]),
      ]);

      // Calculate time boundaries of observed evidence
      let evidenceStartTime: string | null = null;
      let evidenceEndTime: string | null = null;

      for (const ev of eventsRes.rows) {
        const timeStr = new Date(ev.occurred_at).toISOString();
        if (!evidenceStartTime || timeStr < evidenceStartTime) {
          evidenceStartTime = timeStr;
        }
        if (!evidenceEndTime || timeStr > evidenceEndTime) {
          evidenceEndTime = timeStr;
        }
      }

      // Assemble Canonical Investigation Report JSON
      const report = {
        reportMetadata: {
          reportType: 'SECURITY_INVESTIGATION_CASE_REPORT',
          schemaVersion: '1.0.0',
          generatedAt: new Date().toISOString(),
          generatedBy: {
            id: req.user!.id,
            email: req.user!.email,
            fullName: req.user!.full_name,
          },
          workspace: {
            id: c.workspace_id,
            name: c.workspace_name,
          },
        },
        caseInformation: {
          caseId: c.id,
          title: c.title,
          description: c.description,
          status: c.status,
          priority: c.priority,
          assignee: c.assignee_id ? {
            id: c.assignee_id,
            email: c.assignee_email,
            fullName: c.assignee_name,
          } : null,
          createdBy: {
            id: c.created_by,
            email: c.creator_email,
            fullName: c.creator_name,
          },
          createdAt: c.created_at,
          updatedAt: c.updated_at,
          closedAt: c.closed_at,
        },
        investigationScopeAndTimeframe: {
          scopeSummary: `Investigation case covering ${alertsRes.rows.length} detection alert(s) and ${eventsRes.rows.length} linked canonical evidence event(s).`,
          evidenceTimeframe: {
            earliestObservedEvent: evidenceStartTime,
            latestObservedEvent: evidenceEndTime,
            note: 'Reflects the physical timestamps of recorded security telemetry within the ingested log datasets.',
          },
          caseLifecycleTimeframe: {
            investigationOpenedAt: c.created_at,
            investigationClosedAt: c.closed_at,
            currentInvestigationState: c.status,
            note: 'Reflects the operational workflow timeline during which analysts reviewed findings and managed the incident.',
          },
        },
        detections: alertsRes.rows.map((alt) => ({
          alertId: alt.id,
          ruleId: alt.rule_id,
          ruleVersion: alt.rule_version,
          ruleName: alt.rule_name,
          severity: alt.severity,
          status: alt.status,
          title: alt.title,
          summary: alt.summary,
          detectionReason: alt.reason,
          cryptographicFingerprint: alt.fingerprint,
          firstEventAt: alt.first_event_at,
          lastEventAt: alt.last_event_at,
          eventCount: alt.event_count,
          metadata: alt.metadata,
          linkedAt: alt.linked_at,
        })),
        evidenceReferences: eventsRes.rows.map((ev) => ({
          eventId: ev.event_id,
          alertId: ev.alert_id,
          role: ev.role,
          eventType: ev.event_type,
          severity: ev.severity,
          occurredAt: ev.occurred_at,
          sourceHost: ev.source_host,
          username: ev.username,
          sourceIp: ev.source_ip,
          sourcePort: ev.source_port,
          processName: ev.process_name,
          message: ev.message,
          datasetId: ev.dataset_id,
          lineNumber: ev.evidence?.line_number ?? null,
          timestampUncertain: Boolean(ev.evidence?.timestamp_uncertain),
          rawSyslogRecord: ev.evidence?.raw_line ?? null,
        })),
        findingsAndNotes: notesRes.rows.map((n) => ({
          noteId: n.id,
          author: {
            id: n.author_id,
            email: n.author_email,
            fullName: n.author_name,
          },
          content: n.content,
          createdAt: n.created_at,
          updatedAt: n.updated_at,
        })),
        timeline: auditRes.rows.map((a) => ({
          auditId: a.id,
          timestamp: a.created_at,
          action: a.action,
          details: a.details,
          actor: {
            id: a.actor_id,
            email: a.actor_email,
            fullName: a.actor_name,
          },
        })),
        caveatsAndLimitations: [
          'Telemetry records are derived exclusively from log files ingested into this workspace. Absence of a record in the dataset does not prove the absence of malicious activity.',
          'Syslog records lacking explicit calendar year or timezone specifications were normalized assuming UTC under the configured parser ingestion year.',
          'Correlation detections are deterministic and strictly reflect configured rules; external non-ingested data sources are not represented.',
          'Analyst notes reflect expert human assessment and are stored separately from automated detection reasoning.',
        ],
      };

      // Record audit history entry for export
      await pool.query(
        `INSERT INTO case_audit_logs (case_id, workspace_id, actor_id, action, details)
         VALUES ($1, $2, $3, 'report_exported', $4);`,
        [caseId, workspaceId, userId, JSON.stringify({ format: 'json' })]
      );

      res.setHeader('Content-Type', 'application/json');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="investigation-case-${c.id.slice(0, 8)}.json"`
      );
      res.status(200).send(JSON.stringify(report, null, 2));
    } catch (err) {
      next(err);
    }
  }
);

// 10. Request AI Investigation for Case (Analyst+)
casesRouter.post(
  '/:caseId/ai-investigate',
  authenticate,
  requireWorkspaceMember('analyst'),
  aiInvestigationRateLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceId = req.workspace!.id;
      const caseId = String(req.params.caseId);
      const userId = req.user!.id;
      const timeoutMs = req.body?.timeoutMs ? Number(req.body.timeoutMs) : undefined;

      // Assert plan feature entitlement for AI investigation
      await billingService.assertQuota('workspace', workspaceId, 'feature_ai');

      const result = await runAiInvestigation({
        workspaceId,
        caseId,
        userId,
        timeoutMs,
      });

      res.status(200).json({
        status: 'ok',
        message: 'AI investigation completed successfully.',
        investigation: result.investigation,
        analysis: result.analysis,
        scope: result.scope,
      });
    } catch (err: any) {
      if (err instanceof AiProviderError) {
        res.status(err.statusCode).json({
          error: err.code,
          message: err.message,
          details: err.details,
        });
        return;
      }
      next(err);
    }
  }
);

// 11. Get Latest AI Investigation for Case (Viewer+)
casesRouter.get(
  '/:caseId/ai-investigations/latest',
  authenticate,
  requireWorkspaceMember('viewer'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceId = req.workspace!.id;
      const caseId = String(req.params.caseId);

      const investigation = await getLatestAiInvestigation(caseId, workspaceId);
      if (!investigation) {
        res.status(404).json({
          error: 'Not Found',
          message: 'No AI investigation has been conducted for this case yet.',
        });
        return;
      }

      res.status(200).json({
        status: 'ok',
        investigation,
      });
    } catch (err) {
      next(err);
    }
  }
);

// 12. List Past AI Investigations for Case (Viewer+)
casesRouter.get(
  '/:caseId/ai-investigations',
  authenticate,
  requireWorkspaceMember('viewer'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceId = req.workspace!.id;
      const caseId = String(req.params.caseId);

      const historyRes = await pool.query(
        `SELECT id, case_id, workspace_id, requested_by, provider, model, status,
                prompt_tokens, completion_tokens, duration_ms, error_message, created_at
         FROM case_ai_investigations
         WHERE case_id = $1 AND workspace_id = $2
         ORDER BY created_at DESC
         LIMIT 20`,
        [caseId, workspaceId]
      );

      res.status(200).json({
        status: 'ok',
        investigations: historyRes.rows,
      });
    } catch (err) {
      next(err);
    }
  }
);

