"""Linux authentication log parser implementation."""

import re
from datetime import datetime, timezone
from typing import Optional, List, TextIO, Tuple, Dict, Any
from enum import Enum
import uuid
from dataclasses import dataclass

from sentinel_parser.models import (
    NormalizedSecurityEvent,
    EventType,
    SeverityLevel,
    SourceType,
    IngestionSource,
    ParseSummary,
)

PARSER_VERSION = "0.1.0"


class LineStatus(str, Enum):
    VALID = "valid"
    MALFORMED = "malformed"
    UNSUPPORTED = "unsupported"
    SKIPPED = "skipped"


@dataclass
class TimestampParseResult:
    iso_utc: str
    raw_timestamp: str
    uncertain: bool = False
    inferred_year: Optional[int] = None
    inferred_timezone: bool = False
    timezone_assumption: Optional[str] = None


# Standard syslog timestamp: Oct 24 10:14:22 or Oct  4 10:14:22
SYSLOG_LINE_RE = re.compile(
    r"^([A-Z][a-z]{2}\s+\d+\s+\d{2}:\d{2}:\d{2})\s+([^\s]+)\s+([^\[:]+)(?:\[(\d+)\])?:\s+(.*)$"
)

# RFC 5424 / ISO 8601 timestamp: 2026-10-24T10:14:22+00:00
ISO_SYSLOG_LINE_RE = re.compile(
    r"^(\d{4}-\d{2}-\d{2}T[0-9:.]+[\+\-Z0-9:]*)\s+([^\s]+)\s+([^\[:]+)(?:\[(\d+)\])?:\s+(.*)$"
)

# SSH Patterns
SSH_ACCEPTED_RE = re.compile(
    r"Accepted\s+(publickey|password)\s+for\s+(.+?)\s+from\s+([^\s]+)\s+port\s+(\d+)"
)
SSH_FAILED_INVALID_RE = re.compile(
    r"Failed\s+password\s+for\s+invalid\s+user\s+(.+?)\s+from\s+([^\s]+)\s+port\s+(\d+)"
)
SSH_FAILED_RE = re.compile(
    r"Failed\s+password\s+for\s+(.+?)\s+from\s+([^\s]+)\s+port\s+(\d+)"
)
SSH_INVALID_USER_RE = re.compile(
    r"Invalid\s+user\s+(.+?)\s+from\s+([^\s]+)\s+port\s+(\d+)"
)

# PAM Session Patterns
PAM_SESSION_OPEN_RE = re.compile(
    r"pam_unix\([^)]+\):\s+session\s+opened\s+for\s+user\s+([^\s\(]+)"
)
PAM_SESSION_CLOSE_RE = re.compile(
    r"pam_unix\([^)]+\):\s+session\s+closed\s+for\s+user\s+([^\s\(]+)"
)

# Sudo Patterns
SUDO_FAILED_RE = re.compile(
    r"^\s*([^\s:]+)\s*:\s*\d+\s+incorrect\s+password\s+attempt.*COMMAND=(.*)$"
)
SUDO_EXEC_RE = re.compile(
    r"^\s*([^\s:]+)\s*:.*COMMAND=(.*)$"
)

AUTH_DAEMONS = {
    "sshd", "sudo", "su", "pam_unix", "systemd-logind", "login", "passwd", "auth", "polkitd"
}


class LinuxAuthParser:
    """Deterministic parser for Linux authentication telemetry."""

    def __init__(self, default_year: Optional[int] = None):
        self.default_year = default_year or datetime.now(timezone.utc).year

    def parse_timestamp_info(self, ts_str: str) -> Optional[TimestampParseResult]:
        """Convert syslog or ISO8601 timestamp string to UTC ISO8601 with uncertainty tracking."""
        # Try ISO format
        if "T" in ts_str:
            try:
                clean_ts = ts_str.replace("Z", "+00:00")
                dt = datetime.fromisoformat(clean_ts)
                has_tz = dt.tzinfo is not None and dt.utcoffset() is not None
                if has_tz:
                    utc_dt = dt.astimezone(timezone.utc)
                    return TimestampParseResult(
                        iso_utc=utc_dt.isoformat(),
                        raw_timestamp=ts_str,
                        uncertain=False,
                    )
                else:
                    utc_dt = dt.replace(tzinfo=timezone.utc)
                    return TimestampParseResult(
                        iso_utc=utc_dt.isoformat(),
                        raw_timestamp=ts_str,
                        uncertain=True,
                        inferred_timezone=True,
                        timezone_assumption="UTC (omitted in ISO timestamp)",
                    )
            except ValueError:
                return None

        # Try standard BSD syslog format "Oct 24 10:14:22"
        try:
            parts = ts_str.split()
            if len(parts) < 3:
                return None
            month, day, time_part = parts[0], parts[1], parts[2]
            time_parts = time_part.split(":")
            if len(time_parts) != 3:
                return None
            hour, minute, second = int(time_parts[0]), int(time_parts[1]), int(time_parts[2])
            if not (0 <= hour <= 23 and 0 <= minute <= 59 and 0 <= second <= 59):
                return None

            dt = datetime.strptime(f"{self.default_year} {month} {day} {time_part}", "%Y %b %d %H:%M:%S")
            utc_dt = dt.replace(tzinfo=timezone.utc)
            return TimestampParseResult(
                iso_utc=utc_dt.isoformat(),
                raw_timestamp=ts_str,
                uncertain=True,
                inferred_year=self.default_year,
                inferred_timezone=True,
                timezone_assumption="UTC (omitted in BSD syslog)",
            )
        except (ValueError, IndexError):
            return None

    def parse_timestamp(self, ts_str: str) -> Optional[str]:
        """Convert syslog or ISO8601 timestamp string to UTC ISO8601."""
        info = self.parse_timestamp_info(ts_str)
        return info.iso_utc if info else None

    def classify_and_parse_line(
        self,
        raw_line: str,
        line_number: int = 1,
        tenant_id: Optional[str] = None,
        ingestion_source: str = IngestionSource.FILE_UPLOAD.value,
    ) -> Tuple[LineStatus, Optional[NormalizedSecurityEvent]]:
        """Classify a line and return status alongside parsed event if valid."""
        line = raw_line.strip()
        if not line:
            return LineStatus.SKIPPED, None

        # Match syslog header
        match = SYSLOG_LINE_RE.match(line)
        if not match:
            match = ISO_SYSLOG_LINE_RE.match(line)

        if not match:
            # Check for non-syslog structured formats (e.g. JSON or Apache or comments)
            if line.startswith("{") or "HTTP/" in line or line.startswith("#"):
                return LineStatus.UNSUPPORTED, None
            return LineStatus.MALFORMED, None

        ts_raw, host, proc, pid, body = match.groups()
        ts_info = self.parse_timestamp_info(ts_raw)
        if not ts_info:
            return LineStatus.MALFORMED, None

        proc_clean = proc.strip()
        is_auth_daemon = proc_clean in AUTH_DAEMONS

        evidence: Dict[str, Any] = {
            "raw_line": line[:2048],
            "line_number": line_number,
            "raw_timestamp": ts_info.raw_timestamp,
            "timestamp_uncertain": ts_info.uncertain,
            "process_id": int(pid) if pid and pid.isdigit() else None,
            "parser_version": PARSER_VERSION,
        }
        if ts_info.inferred_year:
            evidence["inferred_year"] = ts_info.inferred_year
        if ts_info.inferred_timezone:
            evidence["inferred_timezone"] = True
            evidence["timezone_assumption"] = ts_info.timezone_assumption

        event = NormalizedSecurityEvent(
            id=str(uuid.uuid4()),
            schema_version="1.0.0",
            tenant_id=tenant_id,
            source_type=SourceType.LINUX_AUTH.value,
            source_host=host,
            occurred_at=ts_info.iso_utc,
            observed_at=datetime.now(timezone.utc).isoformat(),
            process_name=proc_clean,
            message=body[:2048],
            evidence=evidence,
            ingestion_source=ingestion_source,
        )

        # Match specific authentication patterns
        # 1. SSH Accepted
        m = SSH_ACCEPTED_RE.search(body)
        if m:
            auth_type, username, source_ip, port = m.groups()
            event.event_type = EventType.SSH_LOGIN_SUCCESS.value
            event.severity = SeverityLevel.INFO.value
            event.username = username
            event.source_ip = source_ip
            event.source_port = int(port)
            event.evidence["auth_method"] = auth_type
            errors = event.validate()
            if errors:
                return LineStatus.MALFORMED, None
            return LineStatus.VALID, event

        # 2. SSH Failed for invalid user
        m = SSH_FAILED_INVALID_RE.search(body)
        if m:
            username, source_ip, port = m.groups()
            event.event_type = EventType.INVALID_USER_ATTEMPT.value
            event.severity = SeverityLevel.MEDIUM.value
            event.username = username
            event.source_ip = source_ip
            event.source_port = int(port)
            errors = event.validate()
            if errors:
                return LineStatus.MALFORMED, None
            return LineStatus.VALID, event

        # 3. SSH Failed password for valid user
        m = SSH_FAILED_RE.search(body)
        if m:
            username, source_ip, port = m.groups()
            event.event_type = EventType.SSH_LOGIN_FAILURE.value
            event.severity = SeverityLevel.LOW.value
            event.username = username
            event.source_ip = source_ip
            event.source_port = int(port)
            errors = event.validate()
            if errors:
                return LineStatus.MALFORMED, None
            return LineStatus.VALID, event

        # 4. SSH Invalid user line
        m = SSH_INVALID_USER_RE.search(body)
        if m:
            username, source_ip, port = m.groups()
            event.event_type = EventType.INVALID_USER_ATTEMPT.value
            event.severity = SeverityLevel.MEDIUM.value
            event.username = username
            event.source_ip = source_ip
            event.source_port = int(port)
            errors = event.validate()
            if errors:
                return LineStatus.MALFORMED, None
            return LineStatus.VALID, event

        # 5. PAM session opened
        m = PAM_SESSION_OPEN_RE.search(body)
        if m:
            username = m.group(1)
            event.event_type = EventType.SESSION_OPENED.value
            event.severity = SeverityLevel.INFO.value
            event.username = username
            errors = event.validate()
            if errors:
                return LineStatus.MALFORMED, None
            return LineStatus.VALID, event

        # 6. PAM session closed
        m = PAM_SESSION_CLOSE_RE.search(body)
        if m:
            username = m.group(1)
            event.event_type = EventType.SESSION_CLOSED.value
            event.severity = SeverityLevel.INFO.value
            event.username = username
            errors = event.validate()
            if errors:
                return LineStatus.MALFORMED, None
            return LineStatus.VALID, event

        # 7. Sudo incorrect password
        m = SUDO_FAILED_RE.search(body)
        if m:
            user, cmd = m.groups()
            event.event_type = EventType.PRIVILEGE_ESCALATION_FAILURE.value
            event.severity = SeverityLevel.HIGH.value
            event.username = user.strip()
            event.evidence["command"] = cmd.strip()
            errors = event.validate()
            if errors:
                return LineStatus.MALFORMED, None
            return LineStatus.VALID, event

        # 8. Sudo command execution
        m = SUDO_EXEC_RE.search(body)
        if m:
            user, cmd = m.groups()
            event.event_type = EventType.SUDO_EXECUTION.value
            event.severity = SeverityLevel.INFO.value
            event.username = user.strip()
            event.evidence["command"] = cmd.strip()
            errors = event.validate()
            if errors:
                return LineStatus.MALFORMED, None
            return LineStatus.VALID, event

        # If not an authentication daemon, it is a valid syslog record from an unsupported subsystem
        if not is_auth_daemon:
            return LineStatus.UNSUPPORTED, None

        # Recognized auth daemon with generic/unclassified security event (e.g. connection closed)
        event.event_type = EventType.GENERIC_SECURITY_EVENT.value
        event.severity = SeverityLevel.INFO.value
        errors = event.validate()
        if errors:
            return LineStatus.MALFORMED, None
        return LineStatus.VALID, event

    def parse_line(
        self,
        raw_line: str,
        line_number: int = 1,
        tenant_id: Optional[str] = None,
        ingestion_source: str = IngestionSource.FILE_UPLOAD.value,
    ) -> Optional[NormalizedSecurityEvent]:
        """Parse a single raw log line into a NormalizedSecurityEvent."""
        status, event = self.classify_and_parse_line(
            raw_line,
            line_number=line_number,
            tenant_id=tenant_id,
            ingestion_source=ingestion_source,
        )
        return event if status == LineStatus.VALID else None

    def parse_lines(
        self,
        lines: List[str],
        tenant_id: Optional[str] = None,
        ingestion_source: str = IngestionSource.FILE_UPLOAD.value,
    ) -> ParseSummary:
        """Parse an iterable list of lines into a ParseSummary."""
        summary = ParseSummary(parser_version=PARSER_VERSION)
        for idx, line in enumerate(lines, start=1):
            if not line.strip():
                summary.skipped_count += 1
                continue

            summary.total_lines += 1
            status, event = self.classify_and_parse_line(
                line,
                line_number=idx,
                tenant_id=tenant_id,
                ingestion_source=ingestion_source,
            )
            if status == LineStatus.VALID and event:
                summary.valid_count += 1
                summary.events.append(event)
            elif status == LineStatus.UNSUPPORTED:
                summary.unsupported_count += 1
            else:
                summary.malformed_count += 1

        return summary

    def parse_file(
        self,
        filepath: str,
        tenant_id: Optional[str] = None,
        ingestion_source: str = IngestionSource.FILE_UPLOAD.value,
    ) -> ParseSummary:
        """Read and parse an entire log file path."""
        with open(filepath, "r", encoding="utf-8", errors="replace") as f:
            lines = f.readlines()
        return self.parse_lines(lines, tenant_id=tenant_id, ingestion_source=ingestion_source)


def parse_line(raw_line: str, line_number: int = 1) -> Optional[NormalizedSecurityEvent]:
    """Convenience helper for parsing a single line."""
    return LinuxAuthParser().parse_line(raw_line, line_number=line_number)


def parse_file(filepath: str) -> ParseSummary:
    """Convenience helper for parsing a file."""
    return LinuxAuthParser().parse_file(filepath)


def parse_lines(lines: List[str]) -> ParseSummary:
    """Convenience helper for parsing lines."""
    return LinuxAuthParser().parse_lines(lines)
