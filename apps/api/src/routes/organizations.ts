import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { pool } from '../database/pool.js';
import { authenticate, requireVerified, requireOrganizationMember, WorkspaceRole } from '../middleware/auth.js';
import { computeIntegrationHealth } from './integrations.js';
import { billingService } from '../services/billing-service.js';
import { logger } from '../config/logger.js';

export const organizationsRouter = Router();

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// 1. Create MSP Organization
organizationsRouter.post('/', authenticate, requireVerified, async (req: Request, res: Response, next: NextFunction) => {
  const client = await pool.connect();
  try {
    const { name, metadata } = req.body;
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      res.status(400).json({ error: 'Validation Error', message: 'Organization name is required.' });
      return;
    }

    const trimmedName = name.trim();
    if (trimmedName.length > 100) {
      res.status(400).json({ error: 'Validation Error', message: 'Organization name cannot exceed 100 characters.' });
      return;
    }

    const slug = `${trimmedName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${crypto.randomBytes(3).toString('hex')}`;
    const orgMetadata = metadata && typeof metadata === 'object' ? metadata : {};

    await client.query('BEGIN');

    const orgRes = await client.query(
      `INSERT INTO organizations (name, slug, created_by, metadata)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, slug, created_by, metadata, created_at;`,
      [trimmedName, slug, req.user!.id, JSON.stringify(orgMetadata)]
    );
    const org = orgRes.rows[0];

    // Atomically assign creator as OWNER of organization
    await client.query(
      `INSERT INTO organization_memberships (organization_id, user_id, role)
       VALUES ($1, $2, 'owner');`,
      [org.id, req.user!.id]
    );

    // Provision initial active MSP plan subscription for new organization
    await client.query(
      `INSERT INTO subscriptions (
        target_type, target_id, plan_id, status, billing_cycle,
        provider, current_period_start, current_period_end
      ) VALUES (
        'organization', $1, 'msp', 'active', 'monthly',
        'razorpay', NOW(), NOW() + INTERVAL '30 days'
      ) ON CONFLICT (target_type, target_id) DO NOTHING;`,
      [org.id]
    );

    await client.query('COMMIT');

    logger.info({ organizationId: org.id, userId: req.user!.id }, 'Created MSP organization');

    res.status(201).json({
      status: 'created',
      organization: {
        id: org.id,
        name: org.name,
        slug: org.slug,
        role: 'owner',
        metadata: org.metadata,
        createdAt: org.created_at,
      },
    });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

// 2. List user's organizations
organizationsRouter.get('/', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await pool.query(
      `SELECT 
        o.id,
        o.name,
        o.slug,
        o.created_by,
        o.metadata,
        o.created_at,
        om.role,
        om.created_at AS member_since,
        (SELECT COUNT(*) FROM organization_memberships WHERE organization_id = o.id)::int AS member_count,
        (SELECT COUNT(*) FROM workspaces WHERE organization_id = o.id)::int AS client_count
       FROM organization_memberships om
       JOIN organizations o ON om.organization_id = o.id
       WHERE om.user_id = $1
       ORDER BY om.created_at ASC`,
      [req.user!.id]
    );

    res.status(200).json({
      status: 'ok',
      organizations: result.rows,
    });
  } catch (err) {
    next(err);
  }
});

// 3. Get Organization Details
organizationsRouter.get('/:organizationId', authenticate, requireOrganizationMember('viewer'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const countsRes = await pool.query(
      `SELECT 
        (SELECT COUNT(*) FROM organization_memberships WHERE organization_id = $1)::int AS member_count,
        (SELECT COUNT(*) FROM workspaces WHERE organization_id = $1)::int AS client_count,
        (SELECT COUNT(*) FROM security_events se 
         JOIN workspaces w ON se.tenant_id = w.id 
         WHERE w.organization_id = $1)::int AS total_events,
        (SELECT COUNT(*) FROM alerts a 
         JOIN workspaces w ON a.workspace_id = w.id 
         WHERE w.organization_id = $1 AND a.status IN ('open', 'acknowledged'))::int AS active_alerts
      `,
      [req.organization!.id]
    );

    const counts = countsRes.rows[0];

    res.status(200).json({
      status: 'ok',
      organization: {
        id: req.organization!.id,
        name: req.organization!.name,
        slug: req.organization!.slug,
        createdBy: req.organization!.created_by,
        myRole: req.orgMembership!.role,
        memberCount: counts.member_count,
        clientCount: counts.client_count,
        totalEvents: counts.total_events,
        activeAlerts: counts.active_alerts,
      },
    });
  } catch (err) {
    next(err);
  }
});

// 4. Update Organization Settings
organizationsRouter.patch('/:organizationId', authenticate, requireOrganizationMember('admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, metadata } = req.body;
    const updates: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim().length === 0) {
        res.status(400).json({ error: 'Validation Error', message: 'Name cannot be empty.' });
        return;
      }
      if (name.trim().length > 100) {
        res.status(400).json({ error: 'Validation Error', message: 'Name cannot exceed 100 characters.' });
        return;
      }
      updates.push(`name = $${idx++}`);
      values.push(name.trim());
    }

    if (metadata !== undefined) {
      if (typeof metadata !== 'object' || metadata === null) {
        res.status(400).json({ error: 'Validation Error', message: 'Metadata must be an object.' });
        return;
      }
      updates.push(`metadata = $${idx++}`);
      values.push(JSON.stringify(metadata));
    }

    if (updates.length === 0) {
      res.status(400).json({ error: 'Validation Error', message: 'No valid fields provided for update.' });
      return;
    }

    updates.push(`updated_at = NOW()`);
    values.push(req.organization!.id);

    const result = await pool.query(
      `UPDATE organizations 
       SET ${updates.join(', ')} 
       WHERE id = $${idx}
       RETURNING id, name, slug, metadata, updated_at`,
      values
    );

    res.status(200).json({
      status: 'ok',
      organization: result.rows[0],
    });
  } catch (err) {
    next(err);
  }
});

// 5. List Organization Members
organizationsRouter.get('/:organizationId/members', authenticate, requireOrganizationMember('viewer'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await pool.query(
      `SELECT 
        om.id AS membership_id,
        om.user_id,
        u.email,
        u.full_name,
        u.is_verified,
        om.role,
        om.created_at AS joined_at
       FROM organization_memberships om
       JOIN users u ON om.user_id = u.id
       WHERE om.organization_id = $1
       ORDER BY 
         CASE om.role 
           WHEN 'owner' THEN 1
           WHEN 'admin' THEN 2
           WHEN 'analyst' THEN 3
           WHEN 'viewer' THEN 4
           ELSE 5
         END,
         om.created_at ASC`,
      [req.organization!.id]
    );

    res.status(200).json({
      status: 'ok',
      members: result.rows.map((r) => ({
        membershipId: r.membership_id,
        userId: r.user_id,
        email: r.email,
        fullName: r.full_name,
        isVerified: Boolean(r.is_verified),
        role: r.role,
        joinedAt: r.joined_at,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// 6. Add Member to Organization
organizationsRouter.post('/:organizationId/members', authenticate, requireOrganizationMember('admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, role } = req.body;

    if (!email || typeof email !== 'string' || !email.includes('@')) {
      res.status(400).json({ error: 'Validation Error', message: 'A valid email is required.' });
      return;
    }

    const validRoles: WorkspaceRole[] = ['owner', 'admin', 'analyst', 'viewer'];
    if (!role || !validRoles.includes(role)) {
      res.status(400).json({ error: 'Validation Error', message: 'Role must be one of: owner, admin, analyst, viewer.' });
      return;
    }

    if (role === 'owner' && req.orgMembership!.role !== 'owner') {
      res.status(403).json({ error: 'Forbidden', message: 'Only organization owners can grant the owner role.' });
      return;
    }

    const userRes = await pool.query(
      `SELECT id, email, full_name, is_verified FROM users WHERE LOWER(email) = LOWER($1)`,
      [email.trim()]
    );

    if (userRes.rows.length === 0) {
      res.status(404).json({ error: 'Not Found', message: 'User with this email does not exist.' });
      return;
    }

    const targetUser = userRes.rows[0];

    const existingRes = await pool.query(
      `SELECT id, role FROM organization_memberships WHERE organization_id = $1 AND user_id = $2`,
      [req.organization!.id, targetUser.id]
    );

    if (existingRes.rows.length > 0) {
      res.status(409).json({ error: 'Conflict', message: 'User is already a member of this organization.' });
      return;
    }

    const insertRes = await pool.query(
      `INSERT INTO organization_memberships (organization_id, user_id, role)
       VALUES ($1, $2, $3)
       RETURNING id, role, created_at`,
      [req.organization!.id, targetUser.id, role]
    );

    res.status(201).json({
      status: 'created',
      member: {
        membershipId: insertRes.rows[0].id,
        userId: targetUser.id,
        email: targetUser.email,
        fullName: targetUser.full_name,
        role: insertRes.rows[0].role,
        joinedAt: insertRes.rows[0].created_at,
      },
    });
  } catch (err) {
    next(err);
  }
});

// 7. Update Member Role
organizationsRouter.patch('/:organizationId/members/:userId', authenticate, requireOrganizationMember('admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userId } = req.params;
    const { role } = req.body;

    const validRoles: WorkspaceRole[] = ['owner', 'admin', 'analyst', 'viewer'];
    if (!role || !validRoles.includes(role)) {
      res.status(400).json({ error: 'Validation Error', message: 'Valid role is required.' });
      return;
    }

    if (role === 'owner' && req.orgMembership!.role !== 'owner') {
      res.status(403).json({ error: 'Forbidden', message: 'Only organization owners can promote members to owner.' });
      return;
    }

    const memberRes = await pool.query(
      `SELECT id, role FROM organization_memberships WHERE organization_id = $1 AND user_id = $2`,
      [req.organization!.id, userId]
    );

    if (memberRes.rows.length === 0) {
      res.status(404).json({ error: 'Not Found', message: 'Member not found in this organization.' });
      return;
    }

    const currentRole = memberRes.rows[0].role;

    if (currentRole === 'owner' && req.orgMembership!.role !== 'owner') {
      res.status(403).json({ error: 'Forbidden', message: 'Only organization owners can modify an owner\'s role.' });
      return;
    }

    if (currentRole === 'owner' && role !== 'owner') {
      const ownerCountRes = await pool.query(
        `SELECT COUNT(*)::int AS count FROM organization_memberships WHERE organization_id = $1 AND role = 'owner'`,
        [req.organization!.id]
      );
      if (ownerCountRes.rows[0].count <= 1) {
        res.status(400).json({ error: 'Validation Error', message: 'Cannot demote the sole owner of an organization.' });
        return;
      }
    }

    const updateRes = await pool.query(
      `UPDATE organization_memberships 
       SET role = $1, updated_at = NOW() 
       WHERE organization_id = $2 AND user_id = $3
       RETURNING id, role, updated_at`,
      [role, req.organization!.id, userId]
    );

    res.status(200).json({
      status: 'ok',
      member: updateRes.rows[0],
    });
  } catch (err) {
    next(err);
  }
});

// 8. Remove Member from Organization
organizationsRouter.delete('/:organizationId/members/:userId', authenticate, requireOrganizationMember('admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userId } = req.params;

    const memberRes = await pool.query(
      `SELECT id, role FROM organization_memberships WHERE organization_id = $1 AND user_id = $2`,
      [req.organization!.id, userId]
    );

    if (memberRes.rows.length === 0) {
      res.status(404).json({ error: 'Not Found', message: 'Member not found in this organization.' });
      return;
    }

    if (memberRes.rows[0].role === 'owner' && req.orgMembership!.role !== 'owner') {
      res.status(403).json({ error: 'Forbidden', message: 'Only organization owners can remove another owner.' });
      return;
    }

    if (memberRes.rows[0].role === 'owner') {
      const ownerCountRes = await pool.query(
        `SELECT COUNT(*)::int AS count FROM organization_memberships WHERE organization_id = $1 AND role = 'owner'`,
        [req.organization!.id]
      );
      if (ownerCountRes.rows[0].count <= 1) {
        res.status(400).json({ error: 'Validation Error', message: 'Cannot remove the sole owner of an organization.' });
        return;
      }
    }

    await pool.query(
      `DELETE FROM organization_memberships WHERE organization_id = $1 AND user_id = $2`,
      [req.organization!.id, userId]
    );

    res.status(200).json({ status: 'ok', message: 'Member removed successfully.' });
  } catch (err) {
    next(err);
  }
});

// 9. List Organization Clients (Client Workspaces)
organizationsRouter.get('/:organizationId/clients', authenticate, requireOrganizationMember('viewer'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await pool.query(
      `SELECT 
        w.id,
        w.name,
        w.slug,
        w.organization_id,
        w.created_by,
        w.metadata,
        w.created_at,
        (SELECT COUNT(*) FROM integrations WHERE workspace_id = w.id AND status != 'revoked')::int AS server_count,
        (SELECT COUNT(*) FROM alerts WHERE workspace_id = w.id AND status IN ('open', 'acknowledged'))::int AS active_alerts_count,
        (SELECT COUNT(*) FROM security_events WHERE tenant_id = w.id)::int AS events_count,
        (SELECT COUNT(*) FROM cases WHERE workspace_id = w.id)::int AS cases_count,
        (SELECT MAX(created_at) FROM alerts WHERE workspace_id = w.id) AS last_alert_at,
        (SELECT MAX(occurred_at) FROM security_events WHERE tenant_id = w.id) AS last_event_at
       FROM workspaces w
       WHERE w.organization_id = $1
       ORDER BY w.name ASC`,
      [req.organization!.id]
    );

    res.status(200).json({
      status: 'ok',
      clients: result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        slug: row.slug,
        organizationId: row.organization_id,
        createdBy: row.created_by,
        metadata: row.metadata,
        createdAt: row.created_at,
        serverCount: row.server_count,
        activeAlertsCount: row.active_alerts_count,
        eventsCount: row.events_count,
        casesCount: row.cases_count,
        lastAlertAt: row.last_alert_at,
        lastEventAt: row.last_event_at,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// 10. Create Client Workspace under Organization
organizationsRouter.post('/:organizationId/clients', authenticate, requireOrganizationMember('admin'), async (req: Request, res: Response, next: NextFunction) => {
  const client = await pool.connect();
  try {
    const { name, metadata } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      res.status(400).json({ error: 'Validation Error', message: 'Client workspace name is required.' });
      return;
    }

    const trimmedName = name.trim();
    if (trimmedName.length > 100) {
      res.status(400).json({ error: 'Validation Error', message: 'Client name cannot exceed 100 characters.' });
      return;
    }

    const slug = `${trimmedName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${crypto.randomBytes(3).toString('hex')}`;
    const clientMetadata = metadata && typeof metadata === 'object' ? metadata : {};

    // Assert plan quota for client workspaces under organization
    await billingService.assertQuota('organization', req.organization!.id, 'client_workspaces', 1);

    await client.query('BEGIN');

    const wsRes = await client.query(
      `INSERT INTO workspaces (name, slug, created_by, organization_id, metadata)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, slug, created_by, organization_id, metadata, created_at;`,
      [trimmedName, slug, req.user!.id, req.organization!.id, JSON.stringify(clientMetadata)]
    );
    const workspace = wsRes.rows[0];

    // Atomically assign creator as workspace OWNER
    await client.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role)
       VALUES ($1, $2, 'owner');`,
      [workspace.id, req.user!.id]
    );

    await client.query('COMMIT');

    logger.info({ organizationId: req.organization!.id, clientId: workspace.id }, 'Created client workspace');

    res.status(201).json({
      status: 'created',
      client: {
        id: workspace.id,
        name: workspace.name,
        slug: workspace.slug,
        organizationId: workspace.organization_id,
        metadata: workspace.metadata,
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

// 11. Centralized Alerts View Across Clients
organizationsRouter.get('/:organizationId/alerts', authenticate, requireOrganizationMember('viewer'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { client_id, severity, status, limit = '50', offset = '0' } = req.query;

    const conditions: string[] = ['w.organization_id = $1'];
    const params: any[] = [req.organization!.id];
    let idx = 2;

    if (client_id && typeof client_id === 'string' && UUID_REGEX.test(client_id)) {
      conditions.push(`a.workspace_id = $${idx++}`);
      params.push(client_id);
    }

    if (severity && typeof severity === 'string') {
      conditions.push(`a.severity = $${idx++}`);
      params.push(severity);
    }

    if (status && typeof status === 'string') {
      conditions.push(`a.status = $${idx++}`);
      params.push(status);
    }

    const whereClause = conditions.join(' AND ');

    // Query alerts
    const alertsQuery = `
      SELECT 
        a.id,
        a.workspace_id AS client_id,
        w.name AS client_name,
        a.rule_name,
        a.title,
        a.summary,
        a.reason,
        a.severity,
        a.status,
        a.created_at,
        a.updated_at
      FROM alerts a
      JOIN workspaces w ON a.workspace_id = w.id
      WHERE ${whereClause}
      ORDER BY a.created_at DESC
      LIMIT $${idx++} OFFSET $${idx++}
    `;

    const countQuery = `
      SELECT COUNT(*)::int AS total
      FROM alerts a
      JOIN workspaces w ON a.workspace_id = w.id
      WHERE ${whereClause}
    `;

    const summaryQuery = `
      SELECT 
        COUNT(CASE WHEN a.severity = 'critical' THEN 1 END)::int AS critical,
        COUNT(CASE WHEN a.severity = 'high' THEN 1 END)::int AS high,
        COUNT(CASE WHEN a.severity = 'medium' THEN 1 END)::int AS medium,
        COUNT(CASE WHEN a.severity = 'low' THEN 1 END)::int AS low,
        COUNT(CASE WHEN a.status = 'open' THEN 1 END)::int AS open_count,
        COUNT(CASE WHEN a.status = 'acknowledged' THEN 1 END)::int AS acknowledged_count,
        COUNT(CASE WHEN a.status = 'resolved' THEN 1 END)::int AS resolved_count,
        COUNT(CASE WHEN a.status = 'dismissed' THEN 1 END)::int AS dismissed_count
      FROM alerts a
      JOIN workspaces w ON a.workspace_id = w.id
      WHERE w.organization_id = $1
    `;

    const queryLimit = Math.min(Math.max(parseInt(String(limit), 10) || 50, 1), 100);
    const queryOffset = Math.max(parseInt(String(offset), 10) || 0, 0);

    const [alertsRes, countRes, summaryRes] = await Promise.all([
      pool.query(alertsQuery, [...params, queryLimit, queryOffset]),
      pool.query(countQuery, params),
      pool.query(summaryQuery, [req.organization!.id]),
    ]);

    const summary = summaryRes.rows[0];

    res.status(200).json({
      status: 'ok',
      alerts: alertsRes.rows,
      total: countRes.rows[0]?.total || 0,
      by_severity: {
        critical: summary.critical,
        high: summary.high,
        medium: summary.medium,
        low: summary.low,
      },
      by_status: {
        open: summary.open_count,
        acknowledged: summary.acknowledged_count,
        resolved: summary.resolved_count,
        dismissed: summary.dismissed_count,
      },
    });
  } catch (err) {
    next(err);
  }
});

// 12. Centralized Fleet Health Across Clients
organizationsRouter.get('/:organizationId/fleet', authenticate, requireOrganizationMember('viewer'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { client_id } = req.query;
    const conditions: string[] = ['w.organization_id = $1'];
    const params: any[] = [req.organization!.id];

    if (client_id && typeof client_id === 'string' && UUID_REGEX.test(client_id)) {
      conditions.push(`i.workspace_id = $2`);
      params.push(client_id);
    }

    const whereClause = conditions.join(' AND ');

    const result = await pool.query(
      `SELECT 
        i.id,
        i.workspace_id AS client_id,
        w.name AS client_name,
        i.name AS server_name,
        i.integration_type,
        i.status AS stored_status,
        i.last_seen_at,
        i.created_at,
        i.metadata
       FROM integrations i
       JOIN workspaces w ON i.workspace_id = w.id
       WHERE ${whereClause}
       ORDER BY w.name ASC, i.name ASC`,
      params
    );

    const servers = result.rows.map((row) => {
      const computed = computeIntegrationHealth(row);
      const agentMetadata = (row.metadata?.agentMetadata || {}) as Record<string, any>;
      const agentDiagnostics = (row.metadata?.agentDiagnostics || null) as Record<string, any> | null;
      return {
        id: row.id,
        clientId: row.client_id,
        clientName: row.client_name,
        name: row.server_name,
        integrationType: row.integration_type,
        status: computed,
        lastSeenAt: row.last_seen_at,
        hostname: agentMetadata.hostname || row.server_name,
        os: agentMetadata.os || null,
        arch: agentMetadata.arch || null,
        agentVersion: agentDiagnostics?.agent_version || agentMetadata.agentVersion || 'v0.1.0',
        metadata: row.metadata,
        diagnostics: agentDiagnostics,
        createdAt: row.created_at,
      };
    });

    const statusCounts = {
      connected: 0,
      degraded: 0,
      inactive: 0,
      disconnected: 0,
      pending: 0,
      revoked: 0,
    };

    for (const s of servers) {
      if (statusCounts[s.status as keyof typeof statusCounts] !== undefined) {
        statusCounts[s.status as keyof typeof statusCounts]++;
      }
    }

    res.status(200).json({
      status: 'ok',
      total_servers: servers.length,
      by_status: statusCounts,
      servers,
    });
  } catch (err) {
    next(err);
  }
});

// 13. Centralized Cases Across Clients
organizationsRouter.get('/:organizationId/cases', authenticate, requireOrganizationMember('viewer'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { client_id, status, priority, limit = '50', offset = '0' } = req.query;

    const conditions: string[] = ['w.organization_id = $1'];
    const params: any[] = [req.organization!.id];
    let idx = 2;

    if (client_id && typeof client_id === 'string' && UUID_REGEX.test(client_id)) {
      conditions.push(`c.workspace_id = $${idx++}`);
      params.push(client_id);
    }

    if (status && typeof status === 'string') {
      conditions.push(`c.status = $${idx++}`);
      params.push(status);
    }

    if (priority && typeof priority === 'string') {
      conditions.push(`c.priority = $${idx++}`);
      params.push(priority);
    }

    const whereClause = conditions.join(' AND ');
    const queryLimit = Math.min(Math.max(parseInt(String(limit), 10) || 50, 1), 100);
    const queryOffset = Math.max(parseInt(String(offset), 10) || 0, 0);

    const casesQuery = `
      SELECT 
        c.id,
        c.workspace_id AS client_id,
        w.name AS client_name,
        c.title,
        c.description,
        c.priority,
        c.status,
        c.assignee_id,
        u.email AS assignee_email,
        u.full_name AS assignee_name,
        c.created_at,
        c.updated_at
      FROM cases c
      JOIN workspaces w ON c.workspace_id = w.id
      LEFT JOIN users u ON c.assignee_id = u.id
      WHERE ${whereClause}
      ORDER BY c.created_at DESC
      LIMIT $${idx++} OFFSET $${idx++}
    `;

    const countQuery = `
      SELECT COUNT(*)::int AS total
      FROM cases c
      JOIN workspaces w ON c.workspace_id = w.id
      WHERE ${whereClause}
    `;

    const [casesRes, countRes] = await Promise.all([
      pool.query(casesQuery, [...params, queryLimit, queryOffset]),
      pool.query(countQuery, params),
    ]);

    res.status(200).json({
      status: 'ok',
      cases: casesRes.rows,
      total: countRes.rows[0]?.total || 0,
    });
  } catch (err) {
    next(err);
  }
});

// 14. Per-Client Usage Visibility & Metrics
organizationsRouter.get('/:organizationId/usage', authenticate, requireOrganizationMember('viewer'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const usageRes = await pool.query(
      `SELECT 
        w.id AS client_id,
        w.name AS client_name,
        w.created_at AS client_created_at,
        (SELECT COUNT(*) FROM security_events WHERE tenant_id = w.id)::int AS events_total,
        (SELECT COUNT(*) FROM security_events 
         WHERE tenant_id = w.id AND occurred_at >= NOW() - INTERVAL '24 hours')::int AS events_24h,
        (SELECT COUNT(*) FROM datasets WHERE workspace_id = w.id)::int AS datasets_count,
        (SELECT COUNT(*) FROM alerts WHERE workspace_id = w.id)::int AS alerts_count,
        (SELECT COUNT(*) FROM cases WHERE workspace_id = w.id)::int AS cases_count,
        (SELECT COUNT(*) FROM case_ai_investigations WHERE workspace_id = w.id)::int AS ai_investigations_count,
        (SELECT COUNT(*) FROM integrations WHERE workspace_id = w.id AND status != 'revoked')::int AS active_servers
       FROM workspaces w
       WHERE w.organization_id = $1
       ORDER BY w.name ASC`,
      [req.organization!.id]
    );

    const totals = {
      total_clients: usageRes.rows.length,
      total_events: usageRes.rows.reduce((acc, r) => acc + r.events_total, 0),
      total_events_24h: usageRes.rows.reduce((acc, r) => acc + r.events_24h, 0),
      total_datasets: usageRes.rows.reduce((acc, r) => acc + r.datasets_count, 0),
      total_alerts: usageRes.rows.reduce((acc, r) => acc + r.alerts_count, 0),
      total_cases: usageRes.rows.reduce((acc, r) => acc + r.cases_count, 0),
      total_ai_investigations: usageRes.rows.reduce((acc, r) => acc + r.ai_investigations_count, 0),
    };

    res.status(200).json({
      status: 'ok',
      totals,
      clients: usageRes.rows,
    });
  } catch (err) {
    next(err);
  }
});

// 15. Consolidated Executive MSP Report
organizationsRouter.get('/:organizationId/reports/consolidated', authenticate, requireOrganizationMember('viewer'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { client_id } = req.query;
    const filterClientId = client_id && typeof client_id === 'string' && UUID_REGEX.test(client_id) ? client_id : null;

    const orgRes = await pool.query(
      `SELECT id, name, slug, created_at FROM organizations WHERE id = $1`,
      [req.organization!.id]
    );

    const clientFilterClause = filterClientId ? 'AND w.id = $2' : '';
    const queryParams = filterClientId ? [req.organization!.id, filterClientId] : [req.organization!.id];

    const [clientsRes, alertsRes, fleetRes] = await Promise.all([
      pool.query(
        `SELECT w.id, w.name, 
          (SELECT COUNT(*) FROM alerts WHERE workspace_id = w.id)::int AS total_alerts,
          (SELECT COUNT(*) FROM alerts WHERE workspace_id = w.id AND status IN ('open', 'investigating'))::int AS open_alerts,
          (SELECT COUNT(*) FROM security_events WHERE tenant_id = w.id)::int AS total_events,
          (SELECT COUNT(*) FROM integrations WHERE workspace_id = w.id AND status != 'revoked')::int AS active_servers,
          (SELECT COUNT(*) FROM case_ai_investigations WHERE workspace_id = w.id)::int AS ai_investigations
         FROM workspaces w
         WHERE w.organization_id = $1 ${clientFilterClause}
         ORDER BY w.name ASC`,
        queryParams
      ),
      pool.query(
        `SELECT a.severity, COUNT(*)::int AS count
         FROM alerts a
         JOIN workspaces w ON a.workspace_id = w.id
         WHERE w.organization_id = $1 ${clientFilterClause}
         GROUP BY a.severity`,
        queryParams
      ),
      pool.query(
        `SELECT i.status, COUNT(*)::int AS count
         FROM integrations i
         JOIN workspaces w ON i.workspace_id = w.id
         WHERE w.organization_id = $1 ${clientFilterClause}
         GROUP BY i.status`,
        queryParams
      ),
    ]);

    const report = {
      reportType: 'MSP Consolidated Security Executive Summary',
      generatedAt: new Date().toISOString(),
      organization: orgRes.rows[0],
      filteredClient: filterClientId,
      summary: {
        totalClientsMonitored: clientsRes.rows.length,
        totalEventsAnalyzed: clientsRes.rows.reduce((sum, c) => sum + c.total_events, 0),
        totalAlertsGenerated: clientsRes.rows.reduce((sum, c) => sum + c.total_alerts, 0),
        activeOpenAlerts: clientsRes.rows.reduce((sum, c) => sum + c.open_alerts, 0),
        totalActiveServers: clientsRes.rows.reduce((sum, c) => sum + c.active_servers, 0),
        alertsBySeverity: Object.fromEntries(alertsRes.rows.map((r) => [r.severity, r.count])),
        serversByStatus: Object.fromEntries(fleetRes.rows.map((r) => [r.status, r.count])),
      },
      totals: {
        clientsCount: clientsRes.rows.length,
        totalServers: fleetRes.rows.reduce((sum, r) => sum + r.count, 0),
        activeServers: clientsRes.rows.reduce((sum, c) => sum + c.active_servers, 0),
        totalEvents: clientsRes.rows.reduce((sum, c) => sum + c.total_events, 0),
        totalAlerts: clientsRes.rows.reduce((sum, c) => sum + c.total_alerts, 0),
        openAlerts: clientsRes.rows.reduce((sum, c) => sum + c.open_alerts, 0),
        aiInvestigations: clientsRes.rows.reduce((sum, c) => sum + (c.ai_investigations || 0), 0),
      },
      clientDetails: clientsRes.rows,
    };

    res.status(200).json({
      status: 'ok',
      report,
    });
  } catch (err) {
    next(err);
  }
});
