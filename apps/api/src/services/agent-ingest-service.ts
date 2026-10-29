import crypto from 'crypto';
import { pool } from '../database/pool.js';
import { validateSecurityEvent } from './schema-validator.js';
import { detectionRunner } from './detection-runner.js';
import { billingService } from './billing-service.js';
import { logger } from '../config/logger.js';

export interface EventIngestItemResult {
  id: string;
  status: 'accepted' | 'duplicate' | 'rejected';
  reason?: string;
}

export interface IngestAgentBatchResult {
  status: 'ok';
  batchStatus: 'accepted' | 'partially_accepted' | 'rejected';
  batchId: string | null;
  total: number;
  acceptedCount: number;
  newlyAcceptedCount: number;
  duplicateCount: number;
  rejectedCount: number;
  alertsGenerated: number;
  items: EventIngestItemResult[];
}

export interface SecurityEventInput {
  id?: string;
  schema_version?: string;
  tenant_id?: string | null;
  integration_id?: string | null;
  source_type: string;
  source_host?: string | null;
  event_type: string;
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical';
  occurred_at: string;
  observed_at?: string;
  username?: string | null;
  source_ip?: string | null;
  source_port?: number | null;
  process_name?: string | null;
  message: string;
  evidence?: Record<string, unknown>;
  ingestion_source?: string;
  created_at?: string;
}

export class AgentIngestService {
  /**
   * Ingests a batch of normalized security events received from an authenticated Linux agent.
   * Enforces tenant isolation, canonical schema compliance, idempotent persistence,
   * integration health updates, and deterministic detection evaluation on newly accepted events.
   */
  public async ingestBatch(
    workspaceId: string,
    integrationId: string,
    rawEvents: unknown[],
    batchId?: string
  ): Promise<IngestAgentBatchResult> {
    if (!Array.isArray(rawEvents) || rawEvents.length === 0) {
      throw new Error('VALIDATION_ERROR: Events must be a non-empty array.');
    }

    if (rawEvents.length > 100) {
      throw new Error('VALIDATION_ERROR: Batch size exceeds maximum limit of 100 events.');
    }

    // Enforce monthly event ingestion quota
    await billingService.assertQuota('workspace', workspaceId, 'monthly_events', rawEvents.length);

    const items: EventIngestItemResult[] = [];
    const validEvents: SecurityEventInput[] = [];

    // 1. Enforce server-authoritative fields and validate each event against canonical schema
    for (let i = 0; i < rawEvents.length; i++) {
      const item = rawEvents[i];
      if (!item || typeof item !== 'object') {
        items.push({
          id: `index-${i}`,
          status: 'rejected',
          reason: `Event at index ${i} is not a valid JSON object.`,
        });
        continue;
      }

      const ev = { ...(item as Record<string, unknown>) } as unknown as SecurityEventInput;

      // Ensure stable id
      if (!ev.id) {
        ev.id = crypto.randomUUID();
      }

      // Default schema version if omitted
      if (!ev.schema_version) {
        ev.schema_version = '1.0.0';
      }

      // Default observed_at if omitted
      if (!ev.observed_at) {
        ev.observed_at = new Date().toISOString();
      }

      // Server enforces workspace isolation, asset attribution, and ingestion source
      ev.tenant_id = workspaceId;
      ev.integration_id = integrationId;
      ev.ingestion_source = 'linux_agent';

      // Schema check
      const validation = validateSecurityEvent(ev);
      if (!validation.valid) {
        const errDesc = validation.errors ? validation.errors.join('; ') : 'Schema validation failed';
        items.push({
          id: ev.id,
          status: 'rejected',
          reason: errDesc,
        });
      } else {
        validEvents.push(ev);
      }
    }

    // If every single event was rejected, return rejected batch result
    if (validEvents.length === 0) {
      return {
        status: 'ok',
        batchStatus: 'rejected',
        batchId: batchId || null,
        total: rawEvents.length,
        acceptedCount: 0,
        newlyAcceptedCount: 0,
        duplicateCount: 0,
        rejectedCount: items.length,
        alertsGenerated: 0,
        items,
      };
    }

    // 2. Persist events idempotently in database transaction
    const newlyAcceptedEvents: SecurityEventInput[] = [];
    let duplicateCount = 0;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const insertQuery = `
        INSERT INTO security_events (
          id, schema_version, tenant_id, source_type, source_host,
          event_type, severity, occurred_at, observed_at, username,
          source_ip, source_port, process_name, message, evidence,
          ingestion_source, dataset_id, integration_id
        ) VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8, $9, $10,
          $11, $12, $13, $14, $15,
          $16, NULL, $17
        )
        ON CONFLICT (id) DO NOTHING
        RETURNING id;
      `;

      for (const ev of validEvents) {
        const res = await client.query(insertQuery, [
          ev.id,
          ev.schema_version,
          ev.tenant_id,
          ev.source_type,
          ev.source_host || null,
          ev.event_type,
          ev.severity,
          ev.occurred_at,
          ev.observed_at,
          ev.username || null,
          ev.source_ip || null,
          ev.source_port || null,
          ev.process_name || null,
          ev.message,
          JSON.stringify(ev.evidence || {}),
          ev.ingestion_source,
          ev.integration_id,
        ]);

        if (res.rows.length > 0) {
          // Successfully inserted new event
          newlyAcceptedEvents.push(ev);
          items.push({
            id: ev.id!,
            status: 'accepted',
          });
        } else {
          // Idempotent duplicate: event already persisted
          duplicateCount++;
          items.push({
            id: ev.id!,
            status: 'duplicate',
            reason: 'Duplicate event ID already persisted in workspace.',
          });
        }
      }

      // Update integration last seen and transition status to 'connected'
      await client.query(
        `UPDATE integrations 
         SET last_seen_at = NOW(), 
             status = CASE WHEN status = 'pending' THEN 'connected' ELSE status END,
             updated_at = NOW() 
         WHERE id = $1 AND workspace_id = $2`,
        [integrationId, workspaceId]
      );

      await client.query('COMMIT');
    } catch (dbErr) {
      await client.query('ROLLBACK');
      logger.error({ err: dbErr, workspaceId, integrationId, batchId }, 'Failed to persist agent events');
      throw dbErr;
    } finally {
      client.release();
    }

    // 3. Evaluate deterministic detections ONLY on newly accepted events (prevent redundant duplicate alerts)
    let alertsGenerated = 0;
    if (newlyAcceptedEvents.length > 0) {
      try {
        const detectionResult = await detectionRunner.runAndPersistDetections(
          workspaceId,
          null,
          newlyAcceptedEvents
        );
        alertsGenerated = detectionResult.generatedCount;
      } catch (detErr) {
        logger.error(
          { err: detErr, workspaceId, integrationId, batchId },
          'Detection evaluation failed for agent event batch'
        );
        // Non-fatal to event ingestion: events are safely stored
      }
    }

    const rejectedCount = items.filter((it) => it.status === 'rejected').length;
    const batchStatus: 'accepted' | 'partially_accepted' | 'rejected' =
      rejectedCount > 0 || duplicateCount > 0 ? 'partially_accepted' : 'accepted';

    logger.info(
      {
        workspaceId,
        integrationId,
        batchId,
        total: rawEvents.length,
        acceptedCount: newlyAcceptedEvents.length,
        duplicateCount,
        rejectedCount,
        alertsGenerated,
        batchStatus,
      },
      'Successfully processed agent event batch'
    );

    return {
      status: 'ok',
      batchStatus,
      batchId: batchId || null,
      total: rawEvents.length,
      acceptedCount: validEvents.length,
      newlyAcceptedCount: newlyAcceptedEvents.length,
      duplicateCount,
      rejectedCount,
      alertsGenerated,
      items,
    };
  }
}

export const agentIngestService = new AgentIngestService();
