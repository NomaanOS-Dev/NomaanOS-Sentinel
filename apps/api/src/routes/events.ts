import { Router, Request, Response, NextFunction } from 'express';
import { validateSecurityEvent } from '../services/schema-validator.js';
import { pool } from '../database/pool.js';
import { billingService } from '../services/billing-service.js';
import { logger } from '../config/logger.js';

export const eventsRouter = Router();

// Ingest a normalized security event
eventsRouter.post('/events', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validation = validateSecurityEvent(req.body);
    if (!validation.valid) {
      res.status(400).json({
        error: 'Validation Error',
        message: 'Security event does not match canonical schema',
        details: validation.errors,
      });
      return;
    }

    const event = req.body;

    if (event.tenant_id) {
      await billingService.assertQuota('workspace', event.tenant_id, 'monthly_events', 1);
    }

    const query = `
      INSERT INTO security_events (
        id, schema_version, tenant_id, source_type, source_host,
        event_type, severity, occurred_at, observed_at, username,
        source_ip, source_port, process_name, message, evidence,
        ingestion_source
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15,
        $16
      )
      RETURNING id, created_at;
    `;

    const values = [
      event.id,
      event.schema_version,
      event.tenant_id || null,
      event.source_type,
      event.source_host || null,
      event.event_type,
      event.severity,
      event.occurred_at,
      event.observed_at || new Date().toISOString(),
      event.username || null,
      event.source_ip || null,
      event.source_port || null,
      event.process_name || null,
      event.message,
      JSON.stringify(event.evidence || {}),
      event.ingestion_source,
    ];

    const result = await pool.query(query, values);

    logger.info({
      eventId: event.id,
      eventType: event.event_type,
      severity: event.severity,
    }, 'Security event ingested successfully');

    res.status(201).json({
      status: 'created',
      event: {
        id: result.rows[0].id,
        created_at: result.rows[0].created_at,
      },
    });
  } catch (err) {
    next(err);
  }
});

// List security events with pagination and filters
eventsRouter.get('/events', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit = Math.min(Math.max(parseInt((req.query.limit as string) || '50', 10), 1), 100);
    const offset = Math.max(parseInt((req.query.offset as string) || '0', 10), 0);
    const severity = req.query.severity as string | undefined;
    const eventType = req.query.event_type as string | undefined;

    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (severity) {
      params.push(severity);
      conditions.push(`severity = $${params.length}`);
    }

    if (eventType) {
      params.push(eventType);
      conditions.push(`event_type = $${params.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(limit, offset);

    const dataQuery = `
      SELECT 
        id, schema_version, tenant_id, dataset_id, source_type, source_host,
        event_type, severity, occurred_at, observed_at, username,
        source_ip, source_port, process_name, message, evidence,
        ingestion_source, created_at
      FROM security_events
      ${whereClause}
      ORDER BY occurred_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `;

    const countQuery = `SELECT COUNT(*) as total FROM security_events ${whereClause}`;
    const countParams = params.slice(0, conditions.length);

    const [dataResult, countResult] = await Promise.all([
      pool.query(dataQuery, params),
      pool.query(countQuery, countParams),
    ]);

    res.status(200).json({
      total: parseInt(countResult.rows[0].total, 10),
      limit,
      offset,
      events: dataResult.rows,
    });
  } catch (err) {
    next(err);
  }
});

