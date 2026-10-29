"""
NomaanOS Sentinel — Rule B: Successful Authentication Following Repeated Failures
Rule ID: AUTH_SUCCESS_AFTER_FAILURES
Version: 1.0.0
"""

from collections import defaultdict
from typing import Any, Dict, List
from sentinel_parser.detection.rules.base import DetectionRule
from sentinel_parser.detection.models import DetectedAlert, AlertEvidence, EventRole
from sentinel_parser.detection.fingerprint import compute_alert_fingerprint


class SuccessAfterFailuresRule(DetectionRule):
    """
    Detects a successful authentication event that follows a qualifying sequence of
    authentication failures for the same user account and source IP within a defined time window.

    Qualifying Failures: At least 3 failures immediately preceding success (configurable).
    Time Window: 600 seconds (10 minutes, configurable).
    Correlation Criteria: Exact match on (username, source_ip).
    Event Ordering: Qualifying failures must occur prior to or at the successful login.
    """

    def __init__(self, failure_threshold: int = 3, window_seconds: int = 600, version: str = "1.0.0"):
        self.rule_id = "AUTH_SUCCESS_AFTER_FAILURES"
        self.rule_version = version
        self.rule_name = "Successful Authentication Following Repeated Failures"
        self.description = (
            f"Detects a successful login preceded by {failure_threshold}+ failed attempts "
            f"from the same source IP and user within {window_seconds} seconds."
        )
        self.failure_threshold = failure_threshold
        self.window_seconds = window_seconds

    def evaluate(self, events: List[Dict[str, Any]], workspace_id: str) -> List[DetectedAlert]:
        alerts: List[DetectedAlert] = []

        # 1. Filter events with valid username and source_ip
        relevant_events: List[Dict[str, Any]] = []
        for ev in events:
            etype = ev.get("event_type")
            if etype in ("ssh_login_failure", "invalid_user_attempt", "ssh_login_success"):
                username = ev.get("username")
                source_ip = ev.get("source_ip")
                if username and source_ip and ev.get("occurred_at"):
                    relevant_events.append(ev)

        if not relevant_events:
            return alerts

        # 2. Partition events by (username, source_ip)
        grouped_events: Dict[tuple, List[Dict[str, Any]]] = defaultdict(list)
        for ev in relevant_events:
            key = (str(ev.get("username")).strip().lower(), str(ev.get("source_ip")).strip().lower())
            grouped_events[key].append(ev)

        # 3. For each group, find successes preceded by qualifying failures
        for (user_key, ip_key), group in grouped_events.items():
            sorted_group = self.sort_events_chronologically(group)

            for idx, ev in enumerate(sorted_group):
                if ev.get("event_type") != "ssh_login_success":
                    continue

                success_dt = self.parse_iso_timestamp(ev.get("occurred_at"))
                if not success_dt:
                    continue

                # Find all preceding failures within window_seconds
                preceding_failures: List[Dict[str, Any]] = []
                for prev_idx in range(idx - 1, -1, -1):
                    prev_ev = sorted_group[prev_idx]
                    if prev_ev.get("event_type") not in ("ssh_login_failure", "invalid_user_attempt"):
                        # If a prior success occurred, stop lookback to associate failures with the immediate success
                        break

                    prev_dt = self.parse_iso_timestamp(prev_ev.get("occurred_at"))
                    if not prev_dt:
                        continue

                    diff = (success_dt - prev_dt).total_seconds()
                    # Failures must be within window and precede or coincide with success
                    if 0 <= diff <= self.window_seconds:
                        preceding_failures.append(prev_ev)
                    elif diff > self.window_seconds:
                        break

                if len(preceding_failures) >= self.failure_threshold:
                    # Reverse to restore chronological order for failures
                    preceding_failures.reverse()

                    first_ev = preceding_failures[0]
                    first_at = str(first_ev.get("occurred_at"))
                    success_at = str(ev.get("occurred_at"))
                    count = len(preceding_failures) + 1

                    original_username = ev.get("username")
                    original_source_ip = ev.get("source_ip")
                    success_id = str(ev.get("id"))

                    # Fingerprint binds rule, version, tenant, user, IP, and the anchor success ID
                    fingerprint = compute_alert_fingerprint(
                        rule_id=self.rule_id,
                        rule_version=self.rule_version,
                        workspace_id=workspace_id,
                        entities=[user_key, ip_key],
                        anchor_event_ids=[success_id],
                    )

                    has_uncertain_ts = any(
                        isinstance(e.get("evidence"), dict) and e.get("evidence", {}).get("timestamp_uncertain") is True
                        for e in preceding_failures + [ev]
                    )

                    evidence_items: List[AlertEvidence] = []
                    for fail_ev in preceding_failures:
                        evidence_items.append(
                            AlertEvidence(
                                event_id=str(fail_ev.get("id")),
                                role=EventRole.PRECEDING_FAILURE.value,
                                occurred_at=fail_ev.get("occurred_at"),
                                line_number=fail_ev.get("evidence", {}).get("line_number") if isinstance(fail_ev.get("evidence"), dict) else None,
                                raw_line=fail_ev.get("evidence", {}).get("raw_line") if isinstance(fail_ev.get("evidence"), dict) else None,
                            )
                        )

                    evidence_items.append(
                        AlertEvidence(
                            event_id=success_id,
                            role=EventRole.SUBSEQUENT_SUCCESS.value,
                            occurred_at=success_at,
                            line_number=ev.get("evidence", {}).get("line_number") if isinstance(ev.get("evidence"), dict) else None,
                            raw_line=ev.get("evidence", {}).get("raw_line") if isinstance(ev.get("evidence"), dict) else None,
                        )
                    )

                    alert = DetectedAlert(
                        rule_id=self.rule_id,
                        rule_version=self.rule_version,
                        rule_name=self.rule_name,
                        severity="high",
                        title=f"Successful login following {len(preceding_failures)} failures for '{original_username}' from {original_source_ip}",
                        summary=(
                            f"Account '{original_username}' successfully authenticated from {original_source_ip} "
                            f"after {len(preceding_failures)} preceding authentication failures."
                        ),
                        reason=(
                            f"Observed successful authentication for user '{original_username}' from source IP {original_source_ip} "
                            f"at {success_at}, preceded by {len(preceding_failures)} failed attempts since {first_at}."
                        ),
                        fingerprint=fingerprint,
                        first_event_at=first_at,
                        last_event_at=success_at,
                        event_count=count,
                        evidence_events=evidence_items,
                        metadata={
                            "username": original_username,
                            "source_ip": original_source_ip,
                            "qualifying_failures": len(preceding_failures),
                            "failure_threshold": self.failure_threshold,
                            "window_seconds": self.window_seconds,
                            "success_event_id": success_id,
                            "has_uncertain_timestamps": has_uncertain_ts,
                        },
                    )
                    alerts.append(alert)

        return alerts

