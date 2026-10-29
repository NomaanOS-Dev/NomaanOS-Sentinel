import { describe, it, expect } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/pool.js';
import { config } from '../src/config/env.js';

describe('Investigation Notes, Status Transitions, and Assignments Verification', () => {
  const app = createApp();

  async function makeUserAndWorkspace(prefix: string) {
    const email = `${prefix}_${crypto.randomBytes(4).toString('hex')}@example.com`;
    const regRes = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email,
        password: 'Password123!',
        fullName: `${prefix} User`,
        workspaceName: `${prefix} Workspace`,
      });
    expect(regRes.status).toBe(201);

    const cookieHeader = regRes.headers['set-cookie'] as unknown as string[];
    const sessionCookie = cookieHeader
      .find((c: string) => c.startsWith(`${config.auth.sessionCookieName}=`))!
      .split(';')[0];
    const workspaceId = regRes.body.workspace.id as string;
    const userId = regRes.body.user.id as string;

    await pool.query('UPDATE users SET is_verified = TRUE WHERE id = $1', [userId]);

    return { userId, cookie: sessionCookie, workspaceId };
  }

  it('validates status transitions, records audit logs, assigns members, and manages notes with strict bounds', async () => {
    const { workspaceId, cookie: ownerCookie, userId: ownerId } = await makeUserAndWorkspace('case_notes_owner');

    // 1. Create a second analyst user in the workspace
    const analystEmail = `analyst_${crypto.randomBytes(4).toString('hex')}@example.com`;
    const aRegRes = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: analystEmail,
        password: 'Password123!',
        fullName: 'Analyst Bob',
        workspaceName: 'Analyst Bob WS',
      });
    const analystId = aRegRes.body.user.id;
    await pool.query('UPDATE users SET is_verified = TRUE WHERE id = $1', [analystId]);
    const aCookieHeader = aRegRes.headers['set-cookie'] as unknown as string[];
    const analystCookie = aCookieHeader
      .find((c: string) => c.startsWith(`${config.auth.sessionCookieName}=`))!
      .split(';')[0];

    // Add analyst to workspace
    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, 'analyst');`,
      [workspaceId, analystId]
    );

    // 2. Create a viewer user in the workspace
    const viewerEmail = `viewer_${crypto.randomBytes(4).toString('hex')}@example.com`;
    const vRegRes = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: viewerEmail,
        password: 'Password123!',
        fullName: 'Viewer Alice',
        workspaceName: 'Viewer Alice WS',
      });
    const viewerId = vRegRes.body.user.id;
    await pool.query('UPDATE users SET is_verified = TRUE WHERE id = $1', [viewerId]);
    const vCookieHeader = vRegRes.headers['set-cookie'] as unknown as string[];
    const viewerCookie = vCookieHeader
      .find((c: string) => c.startsWith(`${config.auth.sessionCookieName}=`))!
      .split(';')[0];

    // Add viewer to workspace
    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, 'viewer');`,
      [workspaceId, viewerId]
    );

    // 3. Create case
    const caseRes = await request(app)
      .post(`/api/v1/workspaces/${workspaceId}/cases`)
      .set('Cookie', ownerCookie)
      .send({
        title: 'Unauthorized Sudo Execution Investigation',
        description: 'Tracking privileged escalation events on db-master',
        priority: 'critical',
      });
    expect(caseRes.status).toBe(201);
    const caseId = caseRes.body.case.id;

    // 4. Test Case Notes
    // Empty note should fail (400)
    const emptyNoteRes = await request(app)
      .post(`/api/v1/workspaces/${workspaceId}/cases/${caseId}/notes`)
      .set('Cookie', analystCookie)
      .send({ content: '   ' });
    expect(emptyNoteRes.status).toBe(400);

    // Oversized note (>10000 chars) should fail (400)
    const oversizedNoteRes = await request(app)
      .post(`/api/v1/workspaces/${workspaceId}/cases/${caseId}/notes`)
      .set('Cookie', analystCookie)
      .send({ content: 'A'.repeat(10001) });
    expect(oversizedNoteRes.status).toBe(400);

    // Valid note addition
    const addNoteRes = await request(app)
      .post(`/api/v1/workspaces/${workspaceId}/cases/${caseId}/notes`)
      .set('Cookie', analystCookie)
      .send({ content: 'Initial triage complete: IP 10.0.2.20 corresponds to deployment bastion.' });
    expect(addNoteRes.status).toBe(201);
    const noteId = addNoteRes.body.note.id;
    expect(addNoteRes.body.note.author.id).toBe(analystId);

    // Viewer cannot add notes (403)
    const viewerNoteRes = await request(app)
      .post(`/api/v1/workspaces/${workspaceId}/cases/${caseId}/notes`)
      .set('Cookie', viewerCookie)
      .send({ content: 'Viewer comment' });
    expect(viewerNoteRes.status).toBe(403);

    // 5. Test Case Assignment
    // Assign to valid analyst member
    const assignRes = await request(app)
      .patch(`/api/v1/workspaces/${workspaceId}/cases/${caseId}/assignee`)
      .set('Cookie', ownerCookie)
      .send({ assigneeId: analystId });
    expect(assignRes.status).toBe(200);
    expect(assignRes.body.case.assignee_id).toBe(analystId);

    // Assign to non-member should fail (400)
    const fakeAssignee = crypto.randomUUID();
    const badAssignRes = await request(app)
      .patch(`/api/v1/workspaces/${workspaceId}/cases/${caseId}/assignee`)
      .set('Cookie', ownerCookie)
      .send({ assigneeId: fakeAssignee });
    expect(badAssignRes.status).toBe(400);

    // Viewer cannot change assignment (403)
    const viewerAssignRes = await request(app)
      .patch(`/api/v1/workspaces/${workspaceId}/cases/${caseId}/assignee`)
      .set('Cookie', viewerCookie)
      .send({ assigneeId: ownerId });
    expect(viewerAssignRes.status).toBe(403);

    // 6. Test Status Transitions
    // Invalid status string should fail (400)
    const badStatusRes = await request(app)
      .patch(`/api/v1/workspaces/${workspaceId}/cases/${caseId}/status`)
      .set('Cookie', analystCookie)
      .send({ status: 'invalid_status_name' });
    expect(badStatusRes.status).toBe(400);

    // Transition: open -> in_progress (valid)
    const inProgRes = await request(app)
      .patch(`/api/v1/workspaces/${workspaceId}/cases/${caseId}/status`)
      .set('Cookie', analystCookie)
      .send({ status: 'in_progress' });
    expect(inProgRes.status).toBe(200);
    expect(inProgRes.body.case.status).toBe('in_progress');

    // Transition: in_progress -> escalated (valid)
    const escRes = await request(app)
      .patch(`/api/v1/workspaces/${workspaceId}/cases/${caseId}/status`)
      .set('Cookie', analystCookie)
      .send({ status: 'escalated' });
    expect(escRes.status).toBe(200);
    expect(escRes.body.case.status).toBe('escalated');

    // Transition: escalated -> open (unsupported transition, should fail with 400)
    const badTransitionRes = await request(app)
      .patch(`/api/v1/workspaces/${workspaceId}/cases/${caseId}/status`)
      .set('Cookie', analystCookie)
      .send({ status: 'open' });
    expect(badTransitionRes.status).toBe(400);

    // Transition: escalated -> closed (valid)
    const closedRes = await request(app)
      .patch(`/api/v1/workspaces/${workspaceId}/cases/${caseId}/status`)
      .set('Cookie', ownerCookie)
      .send({ status: 'closed' });
    expect(closedRes.status).toBe(200);
    expect(closedRes.body.case.status).toBe('closed');
    expect(closedRes.body.case.closed_at).toBeDefined();

    // Transition: closed -> open (reopened, valid)
    const reopenRes = await request(app)
      .patch(`/api/v1/workspaces/${workspaceId}/cases/${caseId}/status`)
      .set('Cookie', ownerCookie)
      .send({ status: 'open' });
    expect(reopenRes.status).toBe(200);
    expect(reopenRes.body.case.status).toBe('open');

    // 7. Verify Audit History has recorded transitions and assignments
    const finalDetailRes = await request(app)
      .get(`/api/v1/workspaces/${workspaceId}/cases/${caseId}`)
      .set('Cookie', ownerCookie);

    expect(finalDetailRes.status).toBe(200);
    const history = finalDetailRes.body.case.auditHistory;
    const actions = history.map((h: any) => h.action);
    expect(actions).toContain('case_created');
    expect(actions).toContain('note_added');
    expect(actions).toContain('assignee_changed');
    expect(actions).toContain('status_changed');

    // Check status changed details
    const statusChanges = history.filter((h: any) => h.action === 'status_changed');
    expect(statusChanges.length).toBeGreaterThanOrEqual(3);
    expect(statusChanges[0].details.previousStatus).toBe('open');
    expect(statusChanges[0].details.newStatus).toBe('in_progress');

    // 8. Test Note Deletion
    const delNoteRes = await request(app)
      .delete(`/api/v1/workspaces/${workspaceId}/cases/${caseId}/notes/${noteId}`)
      .set('Cookie', analystCookie);
    expect(delNoteRes.status).toBe(200);
  });
});

