"""
NomaanOS Sentinel — Detection Engine Base Rule Interface
"""

from abc import ABC, abstractmethod
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from sentinel_parser.detection.models import DetectedAlert


class DetectionRule(ABC):
    """Abstract base class for deterministic detection rules."""

    rule_id: str
    rule_version: str
    rule_name: str
    description: str
    severity: str

    @abstractmethod
    def evaluate(self, events: List[Dict[str, Any]], workspace_id: str) -> List[DetectedAlert]:
        """
        Evaluates a sequence of normalized security events for a specific workspace.
        Must be deterministic, side-effect free, and repeatable.
        """
        pass

    @staticmethod
    def parse_iso_timestamp(ts_str: Optional[str]) -> Optional[datetime]:
        """Safely parses an ISO-8601 UTC timestamp string to a datetime object."""
        if not ts_str or not isinstance(ts_str, str):
            return None
        clean_ts = ts_str.strip()
        if clean_ts.endswith("Z"):
            clean_ts = clean_ts[:-1] + "+00:00"
        try:
            dt = datetime.fromisoformat(clean_ts)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt
        except ValueError:
            return None

    @classmethod
    def sort_events_chronologically(cls, events: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Sorts events chronologically with deterministic tie-breaking.
        Tie-breaking hierarchy:
        1. occurred_at timestamp
        2. physical line_number (from evidence)
        3. event id
        """
        def sort_key(ev: Dict[str, Any]):
            ts = cls.parse_iso_timestamp(ev.get("occurred_at"))
            ts_epoch = ts.timestamp() if ts else 0.0
            evidence = ev.get("evidence") or {}
            line_no = evidence.get("line_number") or 0
            eid = str(ev.get("id") or "")
            return (ts_epoch, line_no, eid)

        return sorted(events, key=sort_key)

