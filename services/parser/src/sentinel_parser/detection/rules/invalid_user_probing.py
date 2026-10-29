"""
NomaanOS Sentinel — Rule D: Invalid User Account Probing
Rule ID: AUTH_INVALID_USER_PROBING
Version: 1.0.0
"""

from collections import defaultdict
from typing import Any, Dict, List
from sentinel_parser.detection.rules.base import DetectionRule
from sentinel_parser.detection.models import DetectedAlert, AlertEvidence, EventRole
from sentinel_parser.detection.fingerprint import compute_alert_fingerprint


class InvalidUserProbingRule(DetectionRule):
    """
    Detects repeated attempts to authenticate against non-existent accounts from a single
    source IP address within a bounded time window. Indicates username enumeration or dictionary scanning.

    Threshold: At least 3 invalid user attempts from the same source IP (configurable).
    Time Window: 300 seconds (5 minutes, configurable).
    """

    def __init__(self, threshold: int = 3, window_seconds: int = 300, version: str = "1.0.0"):
        self.rule_id = "AUTH_INVALID_USER_PROBING"
        self.rule_version = version
        self.rule_name = "Invalid User Account Probing"
        self.description = (
            f"Detects {threshold}+ login attempts against non-existent accounts "
            f"from the same source IP within {window_seconds} seconds."
        )
        self.threshold = threshold
        self.window_seconds = window_seconds

    def evaluate(self, events: List[Dict[str, Any]], workspace_id: str) -> List[DetectedAlert]:
        alerts: List[DetectedAlert] = []

        # 1. Filter events of type invalid_user_attempt with source_ip
        probing_events: List[Dict[str, Any]] = []
        for ev in events:
            if ev.get("event_type") == "invalid_user_attempt":
                if ev.get("source_ip") and ev.get("occurred_at"):
                    probing_events.append(ev)

        if not probing_events:
            return alerts

        # 2. Group by source_ip
        grouped_by_ip: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
        for ev in probing_events:
            ip_str = str(ev.get("source_ip")).strip().lower()
            grouped_by_ip[ip_str].append(ev)

        # 3. For each source IP, evaluate sliding window
        for ip_key, group in grouped_by_ip.items():
            sorted_group = self.sort_events_chronologically(group)
            n = len(sorted_group)
            if n < self.threshold:
                continue

            i = 0
            while i < n:
                dt_i = self.parse_iso_timestamp(sorted_group[i].get("occurred_at"))
                if not dt_i:
                    i += 1
                    continue

                cluster: List[Dict[str, Any]] = [sorted_group[i]]
                j = i + 1
                while j < n:
                    dt_j = self.parse_iso_timestamp(sorted_group[j].get("occurred_at"))
                    if not dt_j:
                        j += 1
                        continue

                    diff = (dt_j - dt_i).total_seconds()
                    if diff <= self.window_seconds:
                        cluster.append(sorted_group[j])
                        j += 1
                    else:
                        break

                if len(cluster) >= self.threshold:
                    first_ev = cluster[0]
                    last_ev = cluster[-1]
                    count = len(cluster)

                    first_at = str(first_ev.get("occurred_at"))
                    last_at = str(last_ev.get("occurred_at"))
                    original_ip = cluster[0].get("source_ip")

                    # Distinct attempted usernames
                    attempted_users = sorted(list(set(str(e.get("username") or "unknown") for e in cluster)))

                    anchor_ids = [str(first_ev.get("id")), str(last_ev.get("id"))]
                    fingerprint = compute_alert_fingerprint(
                        rule_id=self.rule_id,
                        rule_version=self.rule_version,
                        workspace_id=workspace_id,
                        entities=[ip_key],
                        anchor_event_ids=anchor_ids,
                    )

                    has_uncertain_ts = any(
                        isinstance(e.get("evidence"), dict) and e.get("evidence", {}).get("timestamp_uncertain") is True
                        for e in cluster
                    )

                    evidence_items = [
                        AlertEvidence(
                            event_id=str(e.get("id")),
                            role=EventRole.SUPPORTING.value,
                            occurred_at=e.get("occurred_at"),
                            line_number=e.get("evidence", {}).get("line_number") if isinstance(e.get("evidence"), dict) else None,
                            raw_line=e.get("evidence", {}).get("raw_line") if isinstance(e.get("evidence"), dict) else None,
                        )
                        for e in cluster
                    ]

                    alert = DetectedAlert(
                        rule_id=self.rule_id,
                        rule_version=self.rule_version,
                        rule_name=self.rule_name,
                        severity="medium",
                        title=f"Invalid user account probing from {original_ip}",
                        summary=(
                            f"Detected {count} authentication attempts against non-existent accounts "
                            f"from source IP {original_ip} within {self.window_seconds}s."
                        ),
                        reason=(
                            f"Observed {count} invalid user attempts from {original_ip} between {first_at} and {last_at}. "
                            f"Targeted usernames: {', '.join(attempted_users[:5])}{'...' if len(attempted_users) > 5 else ''}."
                        ),
                        fingerprint=fingerprint,
                        first_event_at=first_at,
                        last_event_at=last_at,
                        event_count=count,
                        evidence_events=evidence_items,
                        metadata={
                            "source_ip": original_ip,
                            "attempted_usernames": attempted_users,
                            "attempt_count": count,
                            "threshold": self.threshold,
                            "window_seconds": self.window_seconds,
                            "has_uncertain_timestamps": has_uncertain_ts,
                        },
                    )
                    alerts.append(alert)
                    i = j
                else:
                    i += 1

        return alerts

