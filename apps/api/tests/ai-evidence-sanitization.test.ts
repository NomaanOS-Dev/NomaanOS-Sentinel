import { describe, it, expect } from 'vitest';
import {
  redactSecrets,
  prepareSanitizedEvidence,
} from '../src/services/ai-evidence-sanitizer.js';
import {
  validateAndVerifyAiResponse,
} from '../src/services/ai-response-validator.js';

describe('Evidence Minimization, Redaction & Schema Validation', () => {
  describe('Secret Redaction Engine', () => {
    it('redacts cleartext password parameters in logs', () => {
      const log1 = 'pam_unix(sshd:auth): authentication failure; logname= uid=0 euid=0 tty=ssh ruser= rhost=198.51.100.24 password=SuperSecretPassword123 user=root';
      const redacted = redactSecrets(log1);
      expect(redacted).not.toContain('SuperSecretPassword123');
      expect(redacted).toContain('password=[REDACTED_PASSWORD]');
    });

    it('redacts bearer tokens and authorization headers', () => {
      const log = 'Outbound webhook failed: Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.tokenpayload123';
      const redacted = redactSecrets(log);
      expect(redacted).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
      expect(redacted).toContain('Bearer [REDACTED_TOKEN]');
    });

    it('redacts private cryptographic keys', () => {
      const log = `Attacker attempted key injection:\n-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0Y1W4Q+ExampleFakePrivateKeyContent...\n-----END RSA PRIVATE KEY-----\nOperation halted.`;
      const redacted = redactSecrets(log);
      expect(redacted).not.toContain('MIIEowIBAAKCAQEA');
      expect(redacted).toContain('[REDACTED_PRIVATE_KEY]');
    });

    it('redacts session cookies and tokens', () => {
      const log = 'Cookie parsed: sentinel_session=a8f9c0e3b4d210567e91248a8cf32b11';
      const redacted = redactSecrets(log);
      expect(redacted).not.toContain('a8f9c0e3b4d210567e91248a8cf32b11');
      expect(redacted).toContain('session=[REDACTED_SESSION]');
    });

    it('redacts API keys and secrets formatted as key=value', () => {
      const log = 'Failed connection to cloud service with api_key=sk-proj-9999999999999999999999';
      const redacted = redactSecrets(log);
      expect(redacted).not.toContain('sk-proj-9999999999999999999999');
      expect(redacted).toContain('secret=[REDACTED_SECRET]');
    });
  });

  describe('Evidence Minimization and Bounding', () => {
    it('bounds event count to maximum allowed threshold and retains allowlist IDs', () => {
      const caseRecord = {
        id: '22222222-2222-2222-2222-222222222222',
        title: 'High Volume Attack',
        description: 'Repeated logins',
        status: 'open',
        priority: 'high',
      };

      const alerts = [
        {
          id: '33333333-3333-3333-3333-333333333333',
          rule_id: 'rule_a',
          rule_name: 'Brute Force',
          severity: 'high',
          reason: 'Failed password',
          event_count: 75,
          first_event_at: new Date('2026-10-26T10:00:00Z'),
          last_event_at: new Date('2026-10-26T10:05:00Z'),
        },
      ];

      // Generate 75 events
      const rawEvents = Array.from({ length: 75 }, (_, i) => ({
        id: `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`,
        occurred_at: '2026-10-26T10:00:00Z',
        event_type: 'ssh_login_failure',
        severity: 'warning',
        source_ip: '198.51.100.24',
        source_port: 50000 + i,
        username: `root_${i}`,
        process_name: 'sshd',
        message: `Failed password for root_${i} password=secret${i}`,
      }));

      const originalRawEvents = JSON.parse(JSON.stringify(rawEvents));

      const sanitized = prepareSanitizedEvidence(caseRecord, alerts, rawEvents);

      // Verify bounds
      expect(sanitized.totalEventsBeforeTruncation).toBe(75);
      expect(sanitized.minimizedEvents.length).toBe(50);
      expect(sanitized.isTruncated).toBe(true);

      // Verify authoritative allowlist contains all 75 valid IDs
      expect(sanitized.allowlistEventIds.size).toBe(75);
      expect(sanitized.allowlistEventIds.has(rawEvents[0].id)).toBe(true);
      expect(sanitized.allowlistEventIds.has(rawEvents[74].id)).toBe(true);

      // Verify passwords inside messages are redacted
      expect(sanitized.minimizedEvents[0].message).toContain('password=[REDACTED_PASSWORD]');
      expect(sanitized.minimizedEvents[0].message).not.toContain('secret0');

      // Verify original raw events array was NOT mutated
      expect(rawEvents).toEqual(originalRawEvents);
    });
  });

  describe('Structured Response Schema and Citation Validator', () => {
    const validEventId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const allowlist = new Set([validEventId]);

    const validPayload = {
      summary: 'Grounded security analysis of repeated failed attempts.',
      observed_facts: ['Source IP attempted 5 failed logins within 10 seconds.'],
      hypotheses: ['Automated brute force attack.'],
      unknowns: ['Attacker geographic location.'],
      supporting_event_ids: [validEventId],
      suggested_checks: ['Verify firewall drop rules.'],
      client_summary_draft: 'DRAFT: Security monitoring detected and blocked unauthorized login attempts.',
      limitations: ['Limited to auth.log telemetry.'],
    };

    it('accepts valid structured JSON with verified citations', () => {
      const res = validateAndVerifyAiResponse(JSON.stringify(validPayload), allowlist);
      expect(res.valid).toBe(true);
      if (res.valid) {
        expect(res.data.summary).toBe(validPayload.summary);
        expect(res.data.supporting_event_ids).toContain(validEventId);
      }
    });

    it('strips markdown code fences (```json ... ```) automatically', () => {
      const markdownWrapped = `\`\`\`json\n${JSON.stringify(validPayload, null, 2)}\n\`\`\``;
      const res = validateAndVerifyAiResponse(markdownWrapped, allowlist);
      expect(res.valid).toBe(true);
    });

    it('rejects malformed non-JSON responses with MALFORMED_JSON', () => {
      const res = validateAndVerifyAiResponse('Here is the report: not json { broken', allowlist);
      expect(res.valid).toBe(false);
      if (!res.valid) {
        expect(res.code).toBe('MALFORMED_JSON');
      }
    });

    it('rejects responses missing required schema sections with SCHEMA_VALIDATION_FAILED', () => {
      const missingSummary = { ...validPayload };
      delete (missingSummary as any).summary;

      const res = validateAndVerifyAiResponse(JSON.stringify(missingSummary), allowlist);
      expect(res.valid).toBe(false);
      if (!res.valid) {
        expect(res.code).toBe('SCHEMA_VALIDATION_FAILED');
        expect(res.details?.some((d) => d.includes('summary'))).toBe(true);
      }
    });

    it('rejects responses with unexpected additional properties', () => {
      const withExtra = { ...validPayload, unexpected_code_execution: 'rm -rf /' };
      const res = validateAndVerifyAiResponse(JSON.stringify(withExtra), allowlist);
      expect(res.valid).toBe(false);
      if (!res.valid) {
        expect(res.code).toBe('SCHEMA_VALIDATION_FAILED');
      }
    });

    it('rejects responses citing event IDs not in the authoritative allowlist with INVALID_CITATIONS', () => {
      const fabricatedEventId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
      const withFabricatedCitation = {
        ...validPayload,
        supporting_event_ids: [validEventId, fabricatedEventId],
      };

      const res = validateAndVerifyAiResponse(JSON.stringify(withFabricatedCitation), allowlist);
      expect(res.valid).toBe(false);
      if (!res.valid) {
        expect(res.code).toBe('INVALID_CITATIONS');
        expect(res.error).toContain(fabricatedEventId);
      }
    });
  });
});

