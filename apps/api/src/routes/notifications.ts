import { Router, Request, Response, NextFunction } from 'express';
import { authenticate, requireVerified, requireWorkspaceMember } from '../middleware/auth.js';
import { alertNotificationService } from '../services/alert-notification-service.js';

export const notificationsRouter = Router({ mergeParams: true });

// 1. Get Workspace Notification Settings
notificationsRouter.get(
  '/settings',
  authenticate,
  requireWorkspaceMember('viewer'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceId = req.workspace!.id;
      const settings = await alertNotificationService.getWorkspaceNotificationSettings(workspaceId);

      res.status(200).json({
        status: 'ok',
        workspaceId,
        settings,
      });
    } catch (err) {
      next(err);
    }
  }
);

// 2. Update Workspace Notification Settings (Admin/Owner only)
notificationsRouter.patch(
  '/settings',
  authenticate,
  requireVerified,
  requireWorkspaceMember('admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceId = req.workspace!.id;
      const { enabled, minSeverity, notifyEmails, includeEvidenceSummary } = req.body;

      const updated = await alertNotificationService.updateWorkspaceNotificationSettings(
        workspaceId,
        {
          enabled,
          minSeverity,
          notifyEmails,
          includeEvidenceSummary,
        }
      );

      res.status(200).json({
        status: 'ok',
        workspaceId,
        settings: updated,
        message: 'Notification settings updated successfully.',
      });
    } catch (err: unknown) {
      if (err instanceof Error && err.message.startsWith('VALIDATION_ERROR:')) {
        res.status(400).json({
          error: 'Validation Error',
          message: err.message.replace('VALIDATION_ERROR: ', ''),
        });
        return;
      }
      next(err);
    }
  }
);

// 3. Get Workspace Notification Audit History
notificationsRouter.get(
  '/history',
  authenticate,
  requireWorkspaceMember('viewer'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceId = req.workspace!.id;
      const limit = Math.min(Math.max(parseInt(String(req.query.limit || '50'), 10) || 50, 1), 100);
      const offset = Math.max(parseInt(String(req.query.offset || '0'), 10) || 0, 0);

      const result = await alertNotificationService.getNotificationHistory(
        workspaceId,
        limit,
        offset
      );

      res.status(200).json({
        status: 'ok',
        workspaceId,
        total: result.total,
        limit,
        offset,
        notifications: result.notifications,
      });
    } catch (err) {
      next(err);
    }
  }
);

// 4. Dispatch Test Notification (Admin/Owner only)
notificationsRouter.post(
  '/test',
  authenticate,
  requireVerified,
  requireWorkspaceMember('admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceId = req.workspace!.id;
      const { recipientEmail } = req.body;

      if (!recipientEmail || typeof recipientEmail !== 'string') {
        res.status(400).json({
          error: 'Validation Error',
          message: 'recipientEmail is required to dispatch a test notification.',
        });
        return;
      }

      await alertNotificationService.sendTestNotification(workspaceId, recipientEmail.trim());

      res.status(200).json({
        status: 'ok',
        message: `Test security alert email dispatched to ${recipientEmail.trim()}.`,
      });
    } catch (err: unknown) {
      if (err instanceof Error && err.message.startsWith('VALIDATION_ERROR:')) {
        res.status(400).json({
          error: 'Validation Error',
          message: err.message.replace('VALIDATION_ERROR: ', ''),
        });
        return;
      }
      next(err);
    }
  }
);

