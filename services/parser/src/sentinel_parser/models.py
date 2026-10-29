"""Data models for normalized security events."""

from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from enum import Enum
from typing import Optional, Dict, Any, List
import uuid
import re


class EventType(str, Enum):
    SSH_LOGIN_SUCCESS = "ssh_login_success"
    SSH_LOGIN_FAILURE = "ssh_login_failure"
    INVALID_USER_ATTEMPT = "invalid_user_attempt"
    SUDO_EXECUTION = "sudo_execution"
    SESSION_OPENED = "session_opened"
    SESSION_CLOSED = "session_closed"
    ACCOUNT_LOCKED = "account_locked"
    PRIVILEGE_ESCALATION_FAILURE = "privilege_escalation_failure"
    GENERIC_SECURITY_EVENT = "generic_security_event"


class SeverityLevel(str, Enum):
    INFO = "info"
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class SourceType(str, Enum):
    LINUX_AUTH = "linux_auth"
    WINDOWS_EVENT = "windows_event"
    CLOUD_AUDIT = "cloud_audit"
    NETWORK_FLOW = "network_flow"


class IngestionSource(str, Enum):
    FILE_UPLOAD = "file_upload"
    LINUX_AGENT = "linux_agent"
    API_INGEST = "api_ingest"
    FIXTURE_TEST = "fixture_test"


@dataclass
class NormalizedSecurityEvent:
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    schema_version: str = "1.0.0"
    tenant_id: Optional[str] = None
    source_type: str = SourceType.LINUX_AUTH.value
    source_host: Optional[str] = None
    event_type: str = EventType.GENERIC_SECURITY_EVENT.value
    severity: str = SeverityLevel.INFO.value
    occurred_at: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )
    observed_at: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )
    username: Optional[str] = None
    source_ip: Optional[str] = None
    source_port: Optional[int] = None
    process_name: Optional[str] = None
    message: str = ""
    evidence: Dict[str, Any] = field(default_factory=dict)
    ingestion_source: str = IngestionSource.FILE_UPLOAD.value

    def validate(self) -> List[str]:
        """Validate event fields against the canonical rules."""
        errors: List[str] = []

        # Validate UUID
        try:
            uuid.UUID(self.id)
        except (ValueError, AttributeError):
            errors.append(f"Invalid UUID: {self.id}")

        if self.tenant_id:
            try:
                uuid.UUID(self.tenant_id)
            except (ValueError, AttributeError):
                errors.append(f"Invalid tenant UUID: {self.tenant_id}")

        # Validate severity
        valid_severities = {s.value for s in SeverityLevel}
        if self.severity not in valid_severities:
            errors.append(
                f"Invalid severity '{self.severity}'. Must be one of {valid_severities}"
            )

        # Validate event_type
        valid_event_types = {e.value for e in EventType}
        if self.event_type not in valid_event_types:
            errors.append(
                f"Invalid event_type '{self.event_type}'. Must be one of {valid_event_types}"
            )

        # Validate port
        if self.source_port is not None:
            if not (1 <= self.source_port <= 65535):
                errors.append(
                    f"source_port out of bounds (1-65535): {self.source_port}"
                )

        # Validate IP format (both IPv4 and IPv6)
        if self.source_ip:
            import ipaddress
            try:
                ipaddress.ip_address(self.source_ip)
            except ValueError:
                errors.append(f"Invalid source_ip format: {self.source_ip}")

        # Validate message length
        if len(self.message) > 2048:
            errors.append(
                f"Message length exceeds 2048 characters ({len(self.message)})"
            )

        return errors

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary matching the canonical JSON schema."""
        data = asdict(self)
        return data


@dataclass
class ParseSummary:
    total_lines: int = 0
    valid_count: int = 0
    malformed_count: int = 0
    unsupported_count: int = 0
    skipped_count: int = 0
    parser_version: str = "0.1.0"
    events: List[NormalizedSecurityEvent] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        """Convert parse summary to dictionary representation."""
        return {
            "total_lines": self.total_lines,
            "valid_count": self.valid_count,
            "malformed_count": self.malformed_count,
            "unsupported_count": self.unsupported_count,
            "skipped_count": self.skipped_count,
            "parser_version": self.parser_version,
            "events": [e.to_dict() for e in self.events],
        }

