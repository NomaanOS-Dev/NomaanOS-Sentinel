import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { pool } from '../database/pool.js';
import { authenticate, requireVerified, requireWorkspaceMember, WorkspaceRole } from '../middleware/auth.js';
import { datasetsRouter } from './datasets.js';
import { alertsRouter } from './alerts.js';
import { casesRouter } from './cases.js';
import { integrationsRouter } from './integrations.js';
import { notificationsRouter } from './notifications.js';
import { webhooksRouter } from './webhooks.js';
import { billingService } from '../services/billing-service.js';
import { logger } from '../config/logger.js';

export const workspacesRouter = Router();

// Mount Datasets Ingestion Pipeline
workspacesRouter.use('/:workspaceId/datasets', datasetsRouter);

// Mount Alerts & Detections Pipeline
workspacesRouter.use('/:workspaceId/alerts', alertsRouter);

// Mount Investigation Cases Pipeline
workspacesRouter.use('/:workspaceId/cases', casesRouter);

// Mount Integrations & Monitored Assets Pipeline
workspacesRouter.use('/:workspaceId/integrations', integrationsRouter);

// Mount Workspace Notifications Pipeline
workspacesRouter.use('/:workspaceId/notifications', notificationsRouter);

// Mount Outbound Webhooks Pipeline
workspacesRouter.use('/:workspaceId/webhooks', webhooksRouter);

// 1. Create Workspace
workspacesRouter.post('/', authenticate, requireVerified, async (req: Request, res: Response, next: NextFunction) => {
  const client = await pool.connect();
  try {
    const { name } = req.body;
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      res.status(400).json({ error: 'Validation Error', message: 'Workspace name is required.' });
      return;
    }

    const trimmedName = name.trim();
    if (trimmedName.length > 100) {
      res.status(400).json({ error: 'Validation Error', message: 'Workspace name cannot exceed 100 characters.' });
      return;
    }

    const slug = `${trimmedName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${crypto.randomBytes(3).toString('hex')}`;

    await client.query('BEGIN');

    const wsRes = await client.query(
      `INSERT INTO workspaces (name, slug, created_by)
       VALUES ($1, $2, $3)
       RETURNING id, name, slug, created_by, created_at;`,
      [trimmedName, slug, req.user!.id]
    );
    const workspace = wsRes.rows[0];

    // Atomically assign creator as OWNER
    await client.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role)
       VALUES ($1, $2, 'owner');`,
      [workspace.id, req.user!.id]
    );

    // Provision default Free plan subscription for workspace
    await client.query(
      `INSERT INTO subscriptions (
        target_type, target_id, plan_id, status, billing_cycle,
        provider, current_period_start, current_period_end
      ) VALUES (
        'workspace', $1, 'free', 'active', 'monthly',
        'razorpay', NOW(), NOW() + INTERVAL '30 days'
      ) ON CONFLICT (target_type, target_id) DO NOTHING;`,
      [workspace.id]
    );

    await client.query('COMMIT');

    logger.info({ workspaceId: workspace.id, userId: req.user!.id }, 'Created workspace');

    res.status(201).json({
      status: 'created',
      workspace: {
        id: workspace.id,
        name: workspace.name,
        slug: workspace.slug,
        role: 'owner',
        createdAt: workspace.created_at,
      },
    });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

// 2. List user's workspaces
workspacesRouter.get('/', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await pool.query(
      `SELECT * FROM (
        SELECT DISTINCT ON (w.id)
          w.id,
          w.name,
          w.slug,
          w.created_by,
          w.created_at,
          w.organization_id,
          o.name AS organization_name,
          COALESCE(wm.role, om.role) AS role,
          COALESCE(wm.created_at, om.created_at) AS member_since,
          (SELECT COUNT(*) FROM workspace_memberships WHERE workspace_id = w.id)::int AS member_count
        FROM workspaces w
        LEFT JOIN workspace_memberships wm ON w.id = wm.workspace_id AND wm.user_id = $1
        LEFT JOIN organizations o ON w.organization_id = o.id
        LEFT JOIN organization_memberships om ON w.organization_id = om.organization_id AND om.user_id = $1
        WHERE wm.user_id = $1 OR om.user_id = $1
        ORDER BY w.id, w.created_at ASC
      ) sub
      ORDER BY sub.member_since ASC`,
      [req.user!.id]
    );

    res.status(200).json({
      status: 'ok',
      workspaces: result.rows,
    });
  } catch (err) {
    next(err);
  }
});

// 3. Get Workspace Details
workspacesRouter.get('/:workspaceId', authenticate, requireWorkspaceMember('viewer'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    let organization: { id: string; name: string; slug: string } | null = null;
    if (req.workspace!.organization_id) {
      const orgRes = await pool.query(
        'SELECT id, name, slug FROM organizations WHERE id = $1',
        [req.workspace!.organization_id]
      );
      if (orgRes.rows.length > 0) {
        organization = {
          id: orgRes.rows[0].id,
          name: orgRes.rows[0].name,
          slug: orgRes.rows[0].slug,
        };
      }
    }

    res.status(200).json({
      status: 'ok',
      workspace: {
        id: req.workspace!.id,
        name: req.workspace!.name,
        slug: req.workspace!.slug,
        createdBy: req.workspace!.created_by,
        organizationId: req.workspace!.organization_id || null,
        organization,
        myRole: req.membership!.role,
      },
    });
  } catch (err) {
    next(err);
  }
});

// 4. List Workspace Members
workspacesRouter.get('/:workspaceId/members', authenticate, requireWorkspaceMember('analyst'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await pool.query(
      `SELECT 
        wm.id AS membership_id,
        wm.user_id,
        u.email,
        u.full_name,
        u.is_verified,
        wm.role,
        wm.created_at AS joined_at
       FROM workspace_memberships wm
       JOIN users u ON wm.user_id = u.id
       WHERE wm.workspace_id = $1
       ORDER BY 
         CASE wm.role 
           WHEN 'owner' THEN 1
           WHEN 'admin' THEN 2
           WHEN 'analyst' THEN 3
           WHEN 'viewer' THEN 4
           ELSE 5
         END,
         wm.created_at ASC`,
      [req.workspace!.id]
    );

    const members = result.rows.map((row) => ({
      ...row,
      fullName: row.full_name,
      isVerified: Boolean(row.is_verified),
      is_verified: Boolean(row.is_verified),
    }));

    res.status(200).json({
      status: 'ok',
      members,
    });
  } catch (err) {
    next(err);
  }
});

// 5. Add Workspace Member
workspacesRouter.post('/:workspaceId/members', authenticate, requireVerified, requireWorkspaceMember('admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, role } = req.body;

    if (!email || typeof email !== 'string') {
      res.status(400).json({ error: 'Validation Error', message: 'Target user email is required.' });
      return;
    }

    const validRoles: WorkspaceRole[] = ['admin', 'analyst', 'viewer'];
    // Only an owner can invite another user directly as owner
    if (req.membership!.role === 'owner') {
      validRoles.push('owner');
    }

    const targetRole: WorkspaceRole = role || 'analyst';
    if (!validRoles.includes(targetRole)) {
      res.status(400).json({
        error: 'Validation Error',
        message: `Invalid role '${targetRole}'. Allowed roles: ${validRoles.join(', ')}.`,
      });
      return;
    }

    // Lookup user by email
    const userRes = await pool.query('SELECT id, email, full_name, is_verified FROM users WHERE LOWER(email) = LOWER($1)', [email.trim()]);
    if (userRes.rows.length === 0) {
      res.status(404).json({ error: 'Not Found', message: 'No registered user found with that email address.' });
      return;
    }

    const targetUser = userRes.rows[0];

    // Check if already a member
    const existingMember = await pool.query(
      'SELECT id, role FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2',
      [req.workspace!.id, targetUser.id]
    );

    if (existingMember.rows.length > 0) {
      res.status(409).json({ error: 'Conflict', message: 'User is already a member of this workspace.' });
      return;
    }

    const insertRes = await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role)
       VALUES ($1, $2, $3)
       RETURNING id, role, created_at;`,
      [req.workspace!.id, targetUser.id, targetRole]
    );

    logger.info({
      workspaceId: req.workspace!.id,
      addedUserId: targetUser.id,
      role: targetRole,
      byUserId: req.user!.id,
    }, 'Added member to workspace');

    res.status(201).json({
      status: 'created',
      member: {
        membershipId: insertRes.rows[0].id,
        userId: targetUser.id,
        email: targetUser.email,
        fullName: targetUser.full_name,
        role: targetRole,
        joinedAt: insertRes.rows[0].created_at,
      },
    });
  } catch (err) {
    next(err);
  }
});

// 6. Update Member Role
workspacesRouter.patch('/:workspaceId/members/:userId', authenticate, requireVerified, requireWorkspaceMember('admin'), async (req: Request, res: Response, next: NextFunction) => {
  const client = await pool.connect();
  try {
    const { userId } = req.params;
    const { role: newRole } = req.body;

    const validRoles: WorkspaceRole[] = ['owner', 'admin', 'analyst', 'viewer'];
    if (!newRole || !validRoles.includes(newRole)) {
      res.status(400).json({
        error: 'Validation Error',
        message: `Invalid role. Allowed roles: ${validRoles.join(', ')}.`,
      });
      return;
    }

    // Protection: Users cannot change their own role!
    if (userId === req.user!.id) {
      res.status(400).json({
        error: 'Bad Request',
        message: 'You cannot change your own workspace role.',
      });
      return;
    }

    await client.query('BEGIN');

    // Get target member's current role
    const targetRes = await client.query(
      `SELECT id, role FROM workspace_memberships 
       WHERE workspace_id = $1 AND user_id = $2 FOR UPDATE`,
      [req.workspace!.id, userId]
    );

    if (targetRes.rows.length === 0) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'Not Found', message: 'Member not found in this workspace.' });
      return;
    }

    const currentTargetRole = targetRes.rows[0].role as WorkspaceRole;

    // Admin restriction: Cannot modify an owner, and cannot promote anyone to owner
    if (req.membership!.role === 'admin') {
      if (currentTargetRole === 'owner') {
        await client.query('ROLLBACK');
        res.status(403).json({ error: 'Forbidden', message: 'Admins cannot modify the role of a workspace owner.' });
        return;
      }
      if (newRole === 'owner') {
        await client.query('ROLLBACK');
        res.status(403).json({ error: 'Forbidden', message: 'Only an owner can grant owner privileges.' });
        return;
      }
    }

    // Protection: Demoting an owner requires verifying they are not the sole remaining owner
    if (currentTargetRole === 'owner' && newRole !== 'owner') {
      const ownerCountRes = await client.query(
        `SELECT COUNT(*)::int AS count FROM workspace_memberships 
         WHERE workspace_id = $1 AND role = 'owner'`,
        [req.workspace!.id]
      );
      if (ownerCountRes.rows[0].count <= 1) {
        await client.query('ROLLBACK');
        res.status(400).json({
          error: 'Bad Request',
          message: 'Cannot demote the sole owner of the workspace. Transfer ownership first.',
        });
        return;
      }
    }

    await client.query(
      `UPDATE workspace_memberships 
       SET role = $1, updated_at = NOW() 
       WHERE id = $2`,
      [newRole, targetRes.rows[0].id]
    );

    await client.query('COMMIT');

    logger.info({
      workspaceId: req.workspace!.id,
      targetUserId: userId,
      oldRole: currentTargetRole,
      newRole,
      updatedBy: req.user!.id,
    }, 'Updated workspace member role');

    res.status(200).json({
      status: 'ok',
      message: 'Member role updated successfully.',
      member: {
        userId,
        role: newRole,
      },
    });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

// 7. Remove Member
workspacesRouter.delete('/:workspaceId/members/:userId', authenticate, requireVerified, requireWorkspaceMember('admin'), async (req: Request, res: Response, next: NextFunction) => {
  const client = await pool.connect();
  try {
    const { userId } = req.params;

    // Find target member
    const targetRes = await client.query(
      `SELECT id, role FROM workspace_memberships 
       WHERE workspace_id = $1 AND user_id = $2`,
      [req.workspace!.id, userId]
    );

    if (targetRes.rows.length === 0) {
      res.status(404).json({ error: 'Not Found', message: 'Member not found in this workspace.' });
      return;
    }

    const currentTargetRole = targetRes.rows[0].role as WorkspaceRole;

    // Admin cannot remove an owner
    if (req.membership!.role === 'admin' && currentTargetRole === 'owner') {
      res.status(403).json({ error: 'Forbidden', message: 'Admins cannot remove a workspace owner.' });
      return;
    }

    // Protection: Sole owner cannot be removed
    if (currentTargetRole === 'owner') {
      const ownerCountRes = await client.query(
        `SELECT COUNT(*)::int AS count FROM workspace_memberships 
         WHERE workspace_id = $1 AND role = 'owner'`,
        [req.workspace!.id]
      );
      if (ownerCountRes.rows[0].count <= 1) {
        res.status(400).json({
          error: 'Bad Request',
          message: 'Cannot remove the sole owner of the workspace.',
        });
        return;
      }
    }

    await client.query('DELETE FROM workspace_memberships WHERE id = $1', [targetRes.rows[0].id]);

    logger.info({
      workspaceId: req.workspace!.id,
      removedUserId: userId,
      removedBy: req.user!.id,
    }, 'Removed workspace member');

    res.status(200).json({ status: 'ok', message: 'Member removed from workspace successfully.' });
  } catch (err) {
    next(err);
  } finally {
    client.release();
  }
});

// 8. Workspace Dashboard Overview (Aggregated Metrics & Recent Activity)
workspacesRouter.get(
  '/:workspaceId/dashboard',
  authenticate,
  requireWorkspaceMember('viewer'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceId = req.workspace!.id;

      // 1. Alerts metrics
      const alertsMetricsQuery = `
        SELECT 
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE severity = 'critical')::int AS critical,
          COUNT(*) FILTER (WHERE severity = 'high')::int AS high,
          COUNT(*) FILTER (WHERE severity = 'medium')::int AS medium,
          COUNT(*) FILTER (WHERE severity = 'low')::int AS low,
          COUNT(*) FILTER (WHERE severity = 'info')::int AS info,
          COUNT(*) FILTER (WHERE status = 'open')::int AS open,
          COUNT(*) FILTER (WHERE status = 'acknowledged')::int AS acknowledged,
          COUNT(*) FILTER (WHERE status = 'resolved')::int AS resolved,
          COUNT(*) FILTER (WHERE status = 'dismissed')::int AS dismissed
        FROM alerts
        WHERE workspace_id = $1;
      `;

      // 2. Events metrics
      const eventsMetricsQuery = `
        SELECT 
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE severity = 'critical')::int AS critical,
          COUNT(*) FILTER (WHERE severity = 'high')::int AS high,
          COUNT(*) FILTER (WHERE severity = 'medium')::int AS medium,
          COUNT(*) FILTER (WHERE severity = 'low')::int AS low,
          COUNT(*) FILTER (WHERE severity = 'info')::int AS info
        FROM security_events
        WHERE tenant_id = $1;
      `;

      // 3. Datasets metrics
      const datasetsMetricsQuery = `
        SELECT 
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
          COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
          COUNT(*) FILTER (WHERE status = 'processing')::int AS processing,
          COUNT(*) FILTER (WHERE status = 'queued')::int AS queued
        FROM datasets
        WHERE workspace_id = $1;
      `;

      // 4. Cases metrics
      const casesMetricsQuery = `
        SELECT 
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE status = 'open')::int AS open,
          COUNT(*) FILTER (WHERE status = 'in_progress')::int AS in_progress,
          COUNT(*) FILTER (WHERE status = 'escalated')::int AS escalated,
          COUNT(*) FILTER (WHERE status = 'closed')::int AS closed
        FROM cases
        WHERE workspace_id = $1;
      `;

      // 5. Integrations metrics
      const integrationsMetricsQuery = `
        SELECT 
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
          COUNT(*) FILTER (WHERE status = 'connected')::int AS connected,
          COUNT(*) FILTER (WHERE status = 'disconnected')::int AS disconnected,
          COUNT(*) FILTER (WHERE status = 'error')::int AS error,
          COUNT(*) FILTER (WHERE status = 'revoked')::int AS revoked
        FROM integrations
        WHERE workspace_id = $1;
      `;

      // 6. Recent Alerts (latest 5)
      const recentAlertsQuery = `
        SELECT 
          id, workspace_id, dataset_id, rule_id, rule_version, rule_name,
          severity, status, title, summary, reason, fingerprint,
          first_event_at, last_event_at, event_count, metadata,
          created_at, updated_at
        FROM alerts
        WHERE workspace_id = $1
        ORDER BY created_at DESC, id DESC
        LIMIT 5;
      `;

      // 7. Recent Events (latest 5)
      const recentEventsQuery = `
        SELECT 
          id, schema_version, tenant_id, dataset_id, source_type, source_host,
          event_type, severity, occurred_at, observed_at, username,
          source_ip, source_port, process_name, message, evidence,
          ingestion_source, created_at
        FROM security_events
        WHERE tenant_id = $1
        ORDER BY occurred_at DESC, id DESC
        LIMIT 5;
      `;

      const [alertsRes, eventsRes, datasetsRes, casesRes, integrationsRes, recentAlertsRes, recentEventsRes] = await Promise.all([
        pool.query(alertsMetricsQuery, [workspaceId]),
        pool.query(eventsMetricsQuery, [workspaceId]),
        pool.query(datasetsMetricsQuery, [workspaceId]),
        pool.query(casesMetricsQuery, [workspaceId]),
        pool.query(integrationsMetricsQuery, [workspaceId]),
        pool.query(recentAlertsQuery, [workspaceId]),
        pool.query(recentEventsQuery, [workspaceId]),
      ]);

      const alertStats = alertsRes.rows[0] || {};
      const eventStats = eventsRes.rows[0] || {};
      const datasetStats = datasetsRes.rows[0] || {};
      const caseStats = casesRes.rows[0] || {};
      const integrationStats = integrationsRes.rows[0] || {};

      res.status(200).json({
        status: 'ok',
        workspaceId,
        metrics: {
          alerts: {
            total: alertStats.total || 0,
            bySeverity: {
              critical: alertStats.critical || 0,
              high: alertStats.high || 0,
              medium: alertStats.medium || 0,
              low: alertStats.low || 0,
              info: alertStats.info || 0,
            },
            byStatus: {
              open: alertStats.open || 0,
              acknowledged: alertStats.acknowledged || 0,
              resolved: alertStats.resolved || 0,
              dismissed: alertStats.dismissed || 0,
            },
          },
          events: {
            total: eventStats.total || 0,
            bySeverity: {
              critical: eventStats.critical || 0,
              high: eventStats.high || 0,
              medium: eventStats.medium || 0,
              low: eventStats.low || 0,
              info: eventStats.info || 0,
            },
          },
          datasets: {
            total: datasetStats.total || 0,
            byStatus: {
              completed: datasetStats.completed || 0,
              failed: datasetStats.failed || 0,
              processing: datasetStats.processing || 0,
              queued: datasetStats.queued || 0,
            },
          },
          cases: {
            total: caseStats.total || 0,
            byStatus: {
              open: caseStats.open || 0,
              in_progress: caseStats.in_progress || 0,
              escalated: caseStats.escalated || 0,
              closed: caseStats.closed || 0,
            },
          },
          integrations: {
            total: integrationStats.total || 0,
            byStatus: {
              pending: integrationStats.pending || 0,
              connected: integrationStats.connected || 0,
              disconnected: integrationStats.disconnected || 0,
              error: integrationStats.error || 0,
              revoked: integrationStats.revoked || 0,
            },
          },
        },
        recentAlerts: recentAlertsRes.rows.map((row) => ({
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
        })),
        recentEvents: recentEventsRes.rows,
      });
    } catch (err) {
      next(err);
    }
  }
);

// 9. Workspace-Scoped Security Events Explorer (Search, Filter, Paginate, Deterministic Sort)
workspacesRouter.get(
  '/:workspaceId/events',
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

      const conditions: string[] = ['tenant_id = $1'];
      const params: (string | number)[] = [workspaceId];

      const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
      if (search) {
        params.push(`%${search}%`);
        conditions.push(
          `(username ILIKE $${params.length} OR source_host ILIKE $${params.length} OR HOST(source_ip) ILIKE $${params.length} OR message ILIKE $${params.length})`
        );
      }

      const username = typeof req.query.username === 'string' ? req.query.username.trim() : '';
      if (username) {
        params.push(username);
        conditions.push(`username ILIKE $${params.length}`);
      }

      const host = typeof (req.query.source_host || req.query.host) === 'string'
        ? String(req.query.source_host || req.query.host).trim()
        : '';
      if (host) {
        params.push(host);
        conditions.push(`source_host ILIKE $${params.length}`);
      }

      const ip = typeof (req.query.source_ip || req.query.ip) === 'string'
        ? String(req.query.source_ip || req.query.ip).trim()
        : '';
      if (ip) {
        params.push(ip);
        conditions.push(`HOST(source_ip) = $${params.length}`);
      }

      const severity = typeof req.query.severity === 'string' ? req.query.severity.trim().toLowerCase() : '';
      if (severity && severity !== 'all') {
        params.push(severity);
        conditions.push(`severity = $${params.length}`);
      }

      const eventType = typeof req.query.event_type === 'string' ? req.query.event_type.trim() : '';
      if (eventType && eventType !== 'all') {
        params.push(eventType);
        conditions.push(`event_type = $${params.length}`);
      }

      const datasetId = typeof req.query.dataset_id === 'string' ? req.query.dataset_id.trim() : '';
      if (datasetId) {
        params.push(datasetId);
        conditions.push(`dataset_id = $${params.length}`);
      }

      const from = typeof req.query.from === 'string' ? req.query.from.trim() : '';
      if (from) {
        const fromDate = new Date(from);
        if (isNaN(fromDate.getTime())) {
          res.status(400).json({ error: 'Validation Error', message: 'Invalid from timestamp.' });
          return;
        }
        params.push(fromDate.toISOString());
        conditions.push(`occurred_at >= $${params.length}`);
      }

      const to = typeof req.query.to === 'string' ? req.query.to.trim() : '';
      if (to) {
        const toDate = new Date(to);
        if (isNaN(toDate.getTime())) {
          res.status(400).json({ error: 'Validation Error', message: 'Invalid to timestamp.' });
          return;
        }
        params.push(toDate.toISOString());
        conditions.push(`occurred_at <= $${params.length}`);
      }

      const whereClause = conditions.join(' AND ');

      // Strictly enforce tenant_id = req.workspace.id with deterministic ordering
      const query = `
        SELECT 
          id, schema_version, tenant_id, dataset_id, source_type, source_host,
          event_type, severity, occurred_at, observed_at, username,
          source_ip, source_port, process_name, message, evidence,
          ingestion_source, created_at
        FROM security_events
        WHERE ${whereClause}
        ORDER BY occurred_at DESC, id DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2};
      `;

      const countQuery = `
        SELECT COUNT(*)::int AS total 
        FROM security_events 
        WHERE ${whereClause};
      `;

      const [dataResult, countResult] = await Promise.all([
        pool.query(query, [...params, limit, offset]),
        pool.query(countQuery, params),
      ]);

      const total = countResult.rows[0].total;

      res.status(200).json({
        status: 'ok',
        workspaceId,
        total,
        limit,
        offset,
        page: Math.floor(offset / limit) + 1,
        totalPages: Math.ceil(total / limit) || 1,
        events: dataResult.rows,
      });
    } catch (err) {
      next(err);
    }
  }
);

// 10. Workspace-Scoped Single Security Event Lookup (IDOR-protected)
workspacesRouter.get(
  '/:workspaceId/events/:eventId',
  authenticate,
  requireWorkspaceMember('viewer'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceId = req.workspace!.id;
      const eventId = String(req.params.eventId);

      const query = `
        SELECT 
          id, schema_version, tenant_id, dataset_id, source_type, source_host,
          event_type, severity, occurred_at, observed_at, username,
          source_ip, source_port, process_name, message, evidence,
          ingestion_source, created_at
        FROM security_events
        WHERE id = $1 AND tenant_id = $2;
      `;

      const result = await pool.query(query, [eventId, workspaceId]);
      if (result.rows.length === 0) {
        res.status(404).json({
          error: 'Not Found',
          message: 'Security event not found in this workspace.',
        });
        return;
      }

      res.status(200).json({
        status: 'ok',
        workspaceId,
        event: result.rows[0],
      });
    } catch (err) {
      next(err);
    }
  }
);

