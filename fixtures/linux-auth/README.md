# Synthetic Linux Authentication Log Fixtures

This directory contains deterministic, fictional Linux authentication log fixtures (`/var/log/auth.log` and `/var/log/secure` formats) designed for parser validation, detection rule benchmarking, and integration tests.

---

## Security & Privacy Compliance

- **No Real Customer Data**: All records are deterministically generated synthetic artifacts.
- **RFC 5737 Reserved IP Ranges**: All IP addresses use documentation-reserved blocks:
  - `192.0.2.0/24` (TEST-NET-1)
  - `198.51.100.0/24` (TEST-NET-2)
  - `203.0.113.0/24` (TEST-NET-3)
- **Fictional Usernames & Hosts**: Generic accounts (`deploy`, `analyst`, `admin`, `jdoe`) and documentation hosts (`bastion-01`, `web-prod-01`, `auth-gateway-01`).
- **No Secrets or Credentials**: Only fake hashes and non-sensitive strings are included.

---

## Fixture Catalog

| File Name | Purpose | Expected Normalized Event Types | Expected Severities |
|---|---|---|---|
| `ssh-success.log` | Baseline legitimate SSH publickey and password logins | `ssh_login_success`, `session_opened` | `info` |
| `ssh-failure.log` | Standard SSH password authentication failures | `ssh_login_failure` | `low`, `medium` |
| `invalid-user.log` | Probing attempts with usernames nonexistent on the host | `invalid_user_attempt`, `ssh_login_failure` | `medium` |
| `brute-force-pattern.log` | High-frequency password attempts originating from a single IP | `ssh_login_failure` | `medium` |
| `login-after-failures.log` | Series of failed login attempts followed by a successful login | `ssh_login_failure`, `ssh_login_success`, `session_opened` | `medium`, `info` |
| `session-lifecycle.log` | Complete login-to-logout user session lifecycle | `session_opened`, `session_closed` | `info` |
| `sudo-activity.log` | Privilege escalation commands and sudo authentication errors | `sudo_execution`, `privilege_escalation_failure` | `info`, `high` |
| `malformed-lines.log` | Damaged timestamps, garbage lines, binary noise, missing fields | Parsed as `skipped` or safely handled without crashing | `info` / skipped |
| `mixed-activity.log` | Realistic telemetry interleaving normal sessions, sudo, and brute probes | Mixture of events | `info`, `low`, `medium` |

---

## Schema Mapping Guidelines

When processed by the `sentinel_parser` package:
1. Every parsed line generates an RFC 4122 UUID v4.
2. Timestamps are converted to ISO 8601 UTC. If the log format lacks a year (standard syslog), the current ingestion context year is inferred deterministically.
3. Raw log line number and raw text are retained in `evidence.raw_line` and `evidence.line_number`.
4. Any line that fails parsing does NOT abort batch execution; rather, it increments the parser's `malformed_count` metric and is safely recorded in the parser report.

