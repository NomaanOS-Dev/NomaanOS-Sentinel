import { describe, it, expect } from 'vitest';
import { validateSecurityEvent } from '../src/services/schema-validator.js';

describe('Canonical Security Event JSON Schema', () => {
  const validEvent = {
    id: 'a0000000-0000-0000-0000-000000000001',
    schema_version: '1.0.0',
    tenant_id: 'b0000000-0000-0000-0000-000000000002',
    source_type: 'linux_auth',
    source_host: 'bastion-01',
    event_type: 'ssh_login_failure',
    severity: 'medium',
    occurred_at: '2026-10-24T12:00:00Z',
    observed_at: '2026-10-24T12:00:01Z',
    username: 'admin',
    source_ip: '192.0.2.45',
    source_port: 52410,
    process_name: 'sshd',
    message: 'Failed password for invalid user admin from 192.0.2.45 port 52410 ssh2',
    evidence: {
      raw_line: 'Oct 24 12:00:00 bastion-01 sshd[1234]: Failed password for invalid user admin from 192.0.2.45 port 52410 ssh2',
      line_number: 42,
    },
    ingestion_source: 'file_upload',
  };

  it('validates a well-formed security event', () => {
    const res = validateSecurityEvent(validEvent);
    expect(res.valid).toBe(true);
    expect(res.errors).toBeUndefined();
  });

  it('rejects an event with missing required fields', () => {
    const missingSeverity = { ...validEvent };
    delete (missingSeverity as Record<string, unknown>).severity;

    const res = validateSecurityEvent(missingSeverity);
    expect(res.valid).toBe(false);
    expect(res.errors?.some((e) => e.includes('severity'))).toBe(true);
  });

  it('rejects an invalid severity enumeration', () => {
    const invalidSeverity = { ...validEvent, severity: 'catastrophic' };

    const res = validateSecurityEvent(invalidSeverity);
    expect(res.valid).toBe(false);
    expect(res.errors?.some((e) => e.includes('severity'))).toBe(true);
  });

  it('rejects a malformed UUID', () => {
    const invalidUuid = { ...validEvent, id: 'not-a-valid-uuid' };

    const res = validateSecurityEvent(invalidUuid);
    expect(res.valid).toBe(false);
    expect(res.errors?.some((e) => e.includes('id'))).toBe(true);
  });

  it('rejects out-of-range port numbers', () => {
    const invalidPort = { ...validEvent, source_port: 70000 };

    const res = validateSecurityEvent(invalidPort);
    expect(res.valid).toBe(false);
    expect(res.errors?.some((e) => e.includes('source_port'))).toBe(true);
  });

  it('rejects invalid IP format', () => {
    const invalidIp = { ...validEvent, source_ip: '999.999.999.999' };

    const res = validateSecurityEvent(invalidIp);
    expect(res.valid).toBe(false);
    expect(res.errors?.some((e) => e.includes('source_ip'))).toBe(true);
  });
});

