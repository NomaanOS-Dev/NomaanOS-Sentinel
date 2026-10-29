/**
 * ai-evidence-sanitizer.ts
 * NomaanOS Sentinel: Evidence Minimization and Redaction for AI Analysis.
 *
 * Implements strict data minimization, secret redaction, and bounded context
 * preparation before evidence payloads are supplied to the AI provider.
 */

export interface MinimizedSecurityEvent {
  event_id: string;
  occurred_at: string;
  event_type: string;
  severity: string;
  source_ip: string | null;
  source_port: number | null;
  username: string | null;
  process_name: string | null;
  message: string;
}

export interface SanitizedEvidencePayload {
  caseOverview: {
    id: string;
    title: string;
    description: string;
    status: string;
    priority: string;
  };
  alertsSummary: Array<{
    alert_id: string;
    rule_id: string;
    rule_name: string;
    severity: string;
    reason: string;
    event_count: number;
    first_event_at: string | null;
    last_event_at: string | null;
  }>;
  minimizedEvents: MinimizedSecurityEvent[];
  allowlistEventIds: Set<string>;
  totalEventsBeforeTruncation: number;
  isTruncated: boolean;
}

const SECRET_PATTERNS = [
  // Password parameters (e.g. password=..., pwd: ..., passwd=...)
  {
    regex: /(?:password|passwd|pwd|pass)\s*[:=]\s*(?:'[^']*'|"[^"]*"|\S+)/gi,
    replacement: 'password=[REDACTED_PASSWORD]',
  },
  // Bearer tokens and Authorization headers
  {
    regex: /bearer\s+[a-zA-Z0-9_\-\.]{10,}/gi,
    replacement: 'Bearer [REDACTED_TOKEN]',
  },
  // API Keys / Secrets
  {
    regex: /(?:api[_-]?key|secret|access[_-]?token|auth[_-]?token)\s*[:=]\s*(?:'[^']*'|"[^"]*"|[a-zA-Z0-9_\-\.]{8,})/gi,
    replacement: 'secret=[REDACTED_SECRET]',
  },
  // Private keys (RSA, OpenSSH, EC)
  {
    regex: /-----BEGIN[ A-Z0-9_-]+KEY-----[\s\S]*?-----END[ A-Z0-9_-]+KEY-----/g,
    replacement: '[REDACTED_PRIVATE_KEY]',
  },
  // Session cookies / tokens
  {
    regex: /(?:session[_-]?(?:id|token)?|sentinel_session)\s*[:=]\s*[a-zA-Z0-9_\-\.]{16,}/gi,
    replacement: 'session=[REDACTED_SESSION]',
  },
  // Generic high-entropy hex / base64 tokens of length >= 32
  {
    regex: /\b(?:ghp|gho|glpat|xox[baprs]|sk-[a-zA-Z0-9]{20,})\b/gi,
    replacement: '[REDACTED_API_KEY]',
  },
];

/**
 * Redacts secrets, credentials, and sensitive tokens from arbitrary log text.
 */
export function redactSecrets(text: string | null | undefined): string {
  if (!text) return '';
  let sanitized = String(text);
  for (const { regex, replacement } of SECRET_PATTERNS) {
    sanitized = sanitized.replace(regex, replacement);
  }
  return sanitized;
}

const MAX_EVIDENCE_EVENTS = 50;
const MAX_MESSAGE_LENGTH = 1000;
const MAX_TOTAL_PAYLOAD_CHARS = 100000;

/**
 * Sanitizes and minimizes a list of raw database security events and case metadata.
 * Does NOT mutate the input records.
 */
export function prepareSanitizedEvidence(
  caseRecord: { id: string; title: string; description: string; status: string; priority: string },
  alerts: Array<{
    id: string;
    rule_id: string;
    rule_name: string;
    severity: string;
    reason: string;
    event_count: number;
    first_event_at: string | Date | null;
    last_event_at: string | Date | null;
  }>,
  rawEvents: Array<{
    id?: string;
    event_id?: string;
    occurred_at: string | Date;
    event_type: string;
    severity: string;
    source_ip?: string | null;
    source_port?: number | null;
    username?: string | null;
    process_name?: string | null;
    message?: string | null;
  }>
): SanitizedEvidencePayload {
  const allowlistEventIds = new Set<string>();
  const totalEventsBeforeTruncation = rawEvents.length;

  // 1. Authoritative allowlist of all valid event IDs in this case
  for (const ev of rawEvents) {
    const id = ev.event_id || ev.id;
    if (id && typeof id === 'string') {
      allowlistEventIds.add(id);
    }
  }

  // 2. Bound event count
  const boundedEvents = rawEvents.slice(0, MAX_EVIDENCE_EVENTS);
  const isTruncated = totalEventsBeforeTruncation > MAX_EVIDENCE_EVENTS;

  // 3. Minimize events
  const minimizedEvents: MinimizedSecurityEvent[] = boundedEvents.map((ev) => {
    const id = (ev.event_id || ev.id) as string;
    let rawMsg = ev.message || '';
    if (rawMsg.length > MAX_MESSAGE_LENGTH) {
      rawMsg = rawMsg.slice(0, MAX_MESSAGE_LENGTH) + '... [TRUNCATED]';
    }

    return {
      event_id: id,
      occurred_at: ev.occurred_at instanceof Date ? ev.occurred_at.toISOString() : String(ev.occurred_at),
      event_type: String(ev.event_type || 'unknown'),
      severity: String(ev.severity || 'info'),
      source_ip: ev.source_ip ? String(ev.source_ip) : null,
      source_port: typeof ev.source_port === 'number' ? ev.source_port : null,
      username: ev.username ? redactSecrets(String(ev.username)) : null,
      process_name: ev.process_name ? String(ev.process_name) : null,
      message: redactSecrets(rawMsg),
    };
  });

  // 4. Minimize alerts
  const alertsSummary = alerts.map((a) => ({
    alert_id: a.id,
    rule_id: a.rule_id,
    rule_name: a.rule_name,
    severity: a.severity,
    reason: redactSecrets(a.reason),
    event_count: Number(a.event_count || 0),
    first_event_at: a.first_event_at instanceof Date ? a.first_event_at.toISOString() : (a.first_event_at ? String(a.first_event_at) : null),
    last_event_at: a.last_event_at instanceof Date ? a.last_event_at.toISOString() : (a.last_event_at ? String(a.last_event_at) : null),
  }));

  // 5. Check overall payload size
  let payload: SanitizedEvidencePayload = {
    caseOverview: {
      id: caseRecord.id,
      title: redactSecrets(caseRecord.title),
      description: redactSecrets(caseRecord.description),
      status: caseRecord.status,
      priority: caseRecord.priority,
    },
    alertsSummary,
    minimizedEvents,
    allowlistEventIds,
    totalEventsBeforeTruncation,
    isTruncated,
  };

  const serialized = JSON.stringify(payload);
  if (serialized.length > MAX_TOTAL_PAYLOAD_CHARS) {
    // Aggressively trim events if characters exceed bounds
    const trimmed = minimizedEvents.slice(0, Math.floor(minimizedEvents.length / 2));
    payload = {
      ...payload,
      minimizedEvents: trimmed,
      isTruncated: true,
    };
  }

  return payload;
}

