"""
NomaanOS Sentinel — Rule A: Repeated Authentication Failures
Rule ID: AUTH_REPEATED_FAILURES
Version: 1.0.0
"""

from collections import defaultdict
from typing import Any, Dict, List
from sentinel_parser.detection.rules.base import DetectionRule
from sentinel_parser.detection.models import DetectedAlert, AlertEvidence, EventRole
from sentinel_parser.detection.fingerprint import compute_alert_fingerprint


class RepeatedFailuresRule(DetectionRule):
    """
    Detects repeated authentication failures associated with the same identifiable
    account and source IP within a bounded time window.

    Threshold: At least 5 failed attempts (configurable).
    Time Window: 300 seconds (5 minutes, configurable).
    Missing Identifiers Policy: Events missing either username or source_ip are ignored
    by this rule to prevent false correlations across unrelated users or origins.
    """

    def __init__(self, threshold: int = 5, window_seconds: int = 300, version: str = "1.0.0"):
        self.rule_id = "AUTH_REPEATED_FAILURES"
        self.rule_version = version
        self.rule_name = "Repeated Authentication Failures"
        self.description = (
            f"Detects {threshold}+ authentication failures for a single user account "
            f"from the same source IP within {window_seconds} seconds."
        )
        self.threshold = threshold
        self.window_seconds = window_seconds

    def evaluate(self, events: List[Dict[str, Any]], workspace_id: str) -> List[DetectedAlert]:
        alerts: List[DetectedAlert] = []

        # 1. Filter relevant authentication failure events
        # Required types: ssh_login_failure or invalid_user_attempt
        failure_events: List[Dict[str, Any]] = []
        for ev in events:
            etype = ev.get("event_type")
            if etype in ("ssh_login_failure", "invalid_user_attempt"):
                username = ev.get("username")
                source_ip = ev.get("source_ip")
                # Missing identifier policy: both username and source_ip must be present
                if username and source_ip and ev.get("occurred_at"):
                    failure_events.append(ev)

        if not failure_events:
            return alerts

        # 2. Partition events strictly by (username, source_ip)
        grouped_events: Dict[tuple, List[Dict[str, Any]]] = defaultdict(list)
        for ev in failure_events:
            key = (str(ev.get("username")).strip().lower(), str(ev.get("source_ip")).strip().lower())
            grouped_events[key].append(ev)

        # 3. For each group, evaluate sliding window chronologically
        for (user_key, ip_key), group in grouped_events.items():
            sorted_group = self.sort_events_chronologically(group)
            n = len(sorted_group)
            if n < self.threshold:
                continue

            # Sliding window cluster tracking
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

                    # Severity rationale:
                    # 5-9 failures: medium (potential misconfiguration or initial probe)
                    # 10+ failures: high (aggressive brute-force pressure)
                    severity = "high" if count >= 10 else "medium"

                    original_username = cluster[0].get("username")
                    original_source_ip = cluster[0].get("source_ip")

                    # Anchor IDs for fingerprint
                    anchor_ids = [str(first_ev.get("id")), str(last_ev.get("id"))]
                    fingerprint = compute_alert_fingerprint(
                        rule_id=self.rule_id,
                        rule_version=self.rule_version,
                        workspace_id=workspace_id,
                        entities=[user_key, ip_key],
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
                        severity=severity,
                        title=f"Repeated authentication failures for user '{original_username}' from {original_source_ip}",
                        summary=(
                            f"Detected {count} authentication failures for user '{original_username}' "
                            f"from {original_source_ip} within {self.window_seconds}s."
                        ),
                        reason=(
                            f"Observed {count} failed authentication events for user '{original_username}' "
                            f"from source IP {original_source_ip} between {first_at} and {last_at}."
                        ),
                        fingerprint=fingerprint,
                        first_event_at=first_at,
                        last_event_at=last_at,
                        event_count=count,
                        evidence_events=evidence_items,
                        metadata={
                            "username": original_username,
                            "source_ip": original_source_ip,
                            "failure_count": count,
                            "threshold": self.threshold,
                            "window_seconds": self.window_seconds,
                            "has_uncertain_timestamps": has_uncertain_ts,
                        },
                    )
                    alerts.append(alert)
                    # Advance i past this cluster to avoid duplicate overlapping alerts
                    i = j
                else:
                    i += 1

        return alerts

