"""
NomaanOS Sentinel — Detection Engine Models
Deterministic, evidence-backed security alert definitions and evidence structures.
"""

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional


class EventRole(str, Enum):
    TRIGGER = "trigger"
    SUPPORTING = "supporting"
    PRECEDING_FAILURE = "preceding_failure"
    SUBSEQUENT_SUCCESS = "subsequent_success"
    PRIVILEGED_ACTION = "privileged_action"


@dataclass
class AlertEvidence:
    """Links an alert to an underlying canonical security event with an explicit analytical role."""
    event_id: str
    role: str = EventRole.SUPPORTING.value
    occurred_at: Optional[str] = None
    line_number: Optional[int] = None
    raw_line: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        result = {
            "event_id": self.event_id,
            "role": self.role,
        }
        if self.occurred_at:
            result["occurred_at"] = self.occurred_at
        if self.line_number is not None:
            result["line_number"] = self.line_number
        if self.raw_line:
            result["raw_line"] = self.raw_line
        return result


@dataclass
class DetectedAlert:
    """Deterministic, versioned security alert with cryptographic fingerprint and evidence links."""
    rule_id: str
    rule_version: str
    rule_name: str
    severity: str
    title: str
    summary: str
    reason: str
    fingerprint: str
    first_event_at: str
    last_event_at: str
    event_count: int
    evidence_events: List[AlertEvidence] = field(default_factory=list)
    metadata: Dict[str, Any] = field(default_factory=dict)
    status: str = "open"

    def to_dict(self) -> Dict[str, Any]:
        return {
            "rule_id": self.rule_id,
            "rule_version": self.rule_version,
            "rule_name": self.rule_name,
            "severity": self.severity,
            "title": self.title,
            "summary": self.summary,
            "reason": self.reason,
            "fingerprint": self.fingerprint,
            "first_event_at": self.first_event_at,
            "last_event_at": self.last_event_at,
            "event_count": self.event_count,
            "evidence_events": [e.to_dict() for e in self.evidence_events],
            "metadata": self.metadata,
            "status": self.status,
        }

