import express, { Express } from 'express';
import cookieParser from 'cookie-parser';
import { requestLogger } from './middleware/request-logger.js';
import { errorHandler } from './middleware/error-handler.js';
import { healthRouter } from './routes/health.js';
import { eventsRouter } from './routes/events.js';
import { authRouter } from './routes/auth.js';
import { workspacesRouter } from './routes/workspaces.js';
import { organizationsRouter } from './routes/organizations.js';
import { agentPublicRouter } from './routes/integrations.js';
import { billingRouter } from './routes/billing.js';

export function createApp(): Express {
  const app = express();

  // Bounded JSON body parser with raw body retention for webhook HMAC signature verification
  app.use(
    express.json({
      limit: '2mb',
      verify: (req: any, _res, buf) => {
        req.rawBody = buf;
      },
    })
  );

  // Cookie parser for secure HttpOnly session tokens
  app.use(cookieParser());

  // Correlation IDs and structured request/response logging
  app.use(requestLogger);

  // Health and readiness endpoints
  app.use('/', healthRouter);

  // Versioned API routes
  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1/organizations', organizationsRouter);
  app.use('/api/v1/workspaces', workspacesRouter);
  app.use('/api/v1/integrations', agentPublicRouter);
  app.use('/api/v1/billing', billingRouter);
  app.use('/api/v1', eventsRouter);

  // 404 handler for unmatched routes
  app.use((_req, res) => {
    res.status(404).json({ error: 'Not Found', message: 'Requested route does not exist' });
  });

  // Central sanitized error handler
  app.use(errorHandler);

  return app;
}

