import { Request, Response, NextFunction } from 'express';
import { validateSession, AuthUser, AuthSession } from '../services/session.js';
import { pool } from '../database/pool.js';
import { config } from '../config/env.js';

export type WorkspaceRole = 'owner' | 'admin' | 'analyst' | 'viewer';

export const ROLE_HIERARCHY: Record<WorkspaceRole, number> = {
  owner: 4,
  admin: 3,
  analyst: 2,
  viewer: 1,
};

export interface WorkspaceContext {
  id: string;
  name: string;
  slug: string;
  created_by: string;
  organization_id?: string | null;
}

export interface MembershipContext {
  id: string;
  role: WorkspaceRole;
  created_at: string;
}

export interface OrganizationContext {
  id: string;
  name: string;
  slug: string;
  created_by: string;
}

export interface OrgMembershipContext {
  id: string;
  role: WorkspaceRole;
  created_at: string;
}

// Augment Express Request declaration
declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      session?: AuthSession;
      sessionToken?: string;
      workspace?: WorkspaceContext;
      membership?: MembershipContext;
      organization?: OrganizationContext;
      orgMembership?: OrgMembershipContext;
    }
  }
}

export function isRoleSufficient(userRole: WorkspaceRole, requiredRole: WorkspaceRole): boolean {
  return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[requiredRole];
}

export async function authenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
  const cookieName = config.auth.sessionCookieName;
  let sessionToken: string | undefined = req.cookies?.[cookieName];

  if (!sessionToken && req.headers.authorization?.startsWith('Bearer ')) {
    sessionToken = req.headers.authorization.slice(7).trim();
  }

  if (!sessionToken) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Authentication required. Please sign in.',
    });
    return;
  }

  try {
    const authData = await validateSession(sessionToken);
    if (!authData) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid or expired session. Please sign in again.',
      });
      return;
    }

    req.user = authData.user;
    req.session = authData.session;
    req.sessionToken = sessionToken;
    next();
  } catch (err) {
    next(err);
  }
}

export function requireVerified(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized', message: 'Authentication required.' });
    return;
  }

  if (!req.user.is_verified) {
    res.status(403).json({
      error: 'Forbidden',
      message: 'Email verification is required to perform this action.',
      verificationRequired: true,
    });
    return;
  }

  next();
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function requireWorkspaceMember(requiredRole: WorkspaceRole = 'viewer') {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized', message: 'Authentication required.' });
      return;
    }

    const workspaceId = (req.params.workspaceId || req.headers['x-workspace-id']) as string | undefined;

    if (!workspaceId || !UUID_REGEX.test(workspaceId)) {
      res.status(400).json({
        error: 'Bad Request',
        message: 'A valid workspace UUID is required in the request path or x-workspace-id header.',
      });
      return;
    }

    try {
      const query = `
        SELECT 
          w.id AS workspace_id,
          w.name AS workspace_name,
          w.slug AS workspace_slug,
          w.created_by,
          w.organization_id,
          wm.id AS membership_id,
          wm.role AS workspace_role,
          wm.created_at AS membership_created_at,
          om.id AS org_membership_id,
          om.role AS org_role,
          om.created_at AS org_membership_created_at
        FROM workspaces w
        LEFT JOIN workspace_memberships wm 
          ON w.id = wm.workspace_id AND wm.user_id = $2
        LEFT JOIN organization_memberships om
          ON w.organization_id IS NOT NULL AND w.organization_id = om.organization_id AND om.user_id = $2
        WHERE w.id = $1;
      `;

      const result = await pool.query(query, [workspaceId, req.user.id]);

      if (result.rows.length === 0) {
        // Workspace does not exist
        res.status(404).json({
          error: 'Not Found',
          message: 'Workspace not found.',
        });
        return;
      }

      const row = result.rows[0];

      if (!row.membership_id && !row.org_membership_id) {
        // User is not a member of this workspace or its parent organization
        res.status(403).json({
          error: 'Forbidden',
          message: 'You are not a member of this workspace.',
        });
        return;
      }

      // If user has direct workspace membership, that takes precedence, otherwise inherit organization role
      const userRole = (row.workspace_role || row.org_role) as WorkspaceRole;

      if (!isRoleSufficient(userRole, requiredRole)) {
        res.status(403).json({
          error: 'Forbidden',
          message: `This action requires ${requiredRole} privileges. Current role: ${userRole}.`,
        });
        return;
      }

      req.workspace = {
        id: row.workspace_id,
        name: row.workspace_name,
        slug: row.workspace_slug,
        created_by: row.created_by,
        organization_id: row.organization_id,
      };

      req.membership = {
        id: row.membership_id || row.org_membership_id,
        role: userRole,
        created_at: row.membership_created_at || row.org_membership_created_at,
      };

      next();
    } catch (err) {
      next(err);
    }
  };
}

export function requireOrganizationMember(requiredRole: WorkspaceRole = 'viewer') {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized', message: 'Authentication required.' });
      return;
    }

    const organizationId = (req.params.organizationId || req.headers['x-organization-id']) as string | undefined;

    if (!organizationId || !UUID_REGEX.test(organizationId)) {
      res.status(400).json({
        error: 'Bad Request',
        message: 'A valid organization UUID is required in the request path or x-organization-id header.',
      });
      return;
    }

    try {
      const query = `
        SELECT 
          o.id AS organization_id,
          o.name AS organization_name,
          o.slug AS organization_slug,
          o.created_by,
          om.id AS membership_id,
          om.role,
          om.created_at AS membership_created_at
        FROM organizations o
        LEFT JOIN organization_memberships om 
          ON o.id = om.organization_id AND om.user_id = $2
        WHERE o.id = $1;
      `;

      const result = await pool.query(query, [organizationId, req.user.id]);

      if (result.rows.length === 0) {
        res.status(404).json({
          error: 'Not Found',
          message: 'Organization not found.',
        });
        return;
      }

      const row = result.rows[0];

      if (!row.membership_id) {
        res.status(403).json({
          error: 'Forbidden',
          message: 'You are not a member of this organization.',
        });
        return;
      }

      const userRole = row.role as WorkspaceRole;

      if (!isRoleSufficient(userRole, requiredRole)) {
        res.status(403).json({
          error: 'Forbidden',
          message: `This action requires ${requiredRole} privileges. Current role: ${userRole}.`,
        });
        return;
      }

      req.organization = {
        id: row.organization_id,
        name: row.organization_name,
        slug: row.organization_slug,
        created_by: row.created_by,
      };

      req.orgMembership = {
        id: row.membership_id,
        role: userRole,
        created_at: row.membership_created_at,
      };

      next();
    } catch (err) {
      next(err);
    }
  };
}

