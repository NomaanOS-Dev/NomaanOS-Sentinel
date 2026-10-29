"""
NomaanOS Sentinel — Rule C: Supported Privileged-Account Activity
Rule ID: PRIV_ACCOUNT_ACTIVITY
Version: 1.0.0
"""

import ipaddress
from typing import Any, Dict, List
from sentinel_parser.detection.rules.base import DetectionRule
from sentinel_parser.detection.models import DetectedAlert, AlertEvidence, EventRole
from sentinel_parser.detection.fingerprint import compute_alert_fingerprint


class PrivilegedActivityRule(DetectionRule):
    """
    Detects explicitly evidenced privileged-account activity.

    Privileged Accounts Policy:
    - Accounts qualifying as privileged: 'root' user directly, or any user executing
      elevated commands via 'sudo_command'.
    - Non-root account names (e.g. 'admin', 'operator', 'deploy') are NOT assumed to be privileged
      unless executing a verified 'sudo_command'.

    Supported Detections:
    1. Direct SSH root logins (ssh_login_success with username == 'root').
    2. Sudo command executions (sudo_command).
    3. Privileged session opening (session_opened with username == 'root').

    Documented Limitations:
    - The current syslog parser cannot inspect internal arguments of executed commands
      if not logged by PAM.
    - Non-PAM process invocations or setuid executions without syslog entries are not detectable.
    """

    def __init__(self, version: str = "1.0.0"):
        self.rule_id = "PRIV_ACCOUNT_ACTIVITY"
        self.rule_version = version
        self.rule_name = "Supported Privileged-Account Activity"
        self.description = (
            "Detects verified privileged-account actions including direct root SSH logins, "
            "sudo command executions, and root PAM session transitions."
        )

    INTERNAL_NETWORKS = [
        ipaddress.ip_network("10.0.0.0/8"),
        ipaddress.ip_network("172.16.0.0/12"),
        ipaddress.ip_network("192.168.0.0/16"),
        ipaddress.ip_network("127.0.0.0/8"),
        ipaddress.ip_network("::1/128"),
        ipaddress.ip_network("fe80::/10"),
    ]

    @classmethod
    def is_external_ip(cls, ip_str: Any) -> bool:
        if not ip_str or not isinstance(ip_str, str):
            return False
        try:
            ip = ipaddress.ip_address(ip_str.strip())
            return not any(ip in net for net in cls.INTERNAL_NETWORKS)
        except ValueError:
            return False

    def evaluate(self, events: List[Dict[str, Any]], workspace_id: str) -> List[DetectedAlert]:
        alerts: List[DetectedAlert] = []

        for ev in events:
            etype = ev.get("event_type")
            username = ev.get("username")
            source_ip = ev.get("source_ip")
            occurred_at = ev.get("occurred_at")
            event_id = str(ev.get("id"))

            if not occurred_at or not event_id:
                continue

            is_privileged_event = False
            action_description = ""
            severity = "medium"

            # 1. Direct SSH root login
            if etype == "ssh_login_success" and username == "root":
                is_privileged_event = True
                is_ext = self.is_external_ip(source_ip)
                severity = "high" if is_ext else "medium"
                action_description = (
                    f"Direct SSH root login from {'external' if is_ext else 'internal'} IP {source_ip or 'unknown'}"
                )

            # 2. Sudo command execution
            elif etype in ("sudo_command", "sudo_execution"):
                is_privileged_event = True
                severity = "medium"
                action_description = f"Elevated command execution via sudo by user '{username or 'unknown'}'"

            # 3. Privileged session opened for root
            elif etype == "session_opened" and username == "root":
                is_privileged_event = True
                severity = "medium"
                action_description = "PAM authentication session opened for root user"

            if is_privileged_event:
                host_str = ev.get("source_host") or "unknown-host"
                fingerprint = compute_alert_fingerprint(
                    rule_id=self.rule_id,
                    rule_version=self.rule_version,
                    workspace_id=workspace_id,
                    entities=[str(username or "root"), str(source_ip or host_str)],
                    anchor_event_ids=[event_id],
                )

                has_uncertain_ts = (
                    isinstance(ev.get("evidence"), dict)
                    and ev.get("evidence", {}).get("timestamp_uncertain") is True
                )

                evidence_items = [
                    AlertEvidence(
                        event_id=event_id,
                        role=EventRole.PRIVILEGED_ACTION.value,
                        occurred_at=occurred_at,
                        line_number=ev.get("evidence", {}).get("line_number") if isinstance(ev.get("evidence"), dict) else None,
                        raw_line=ev.get("evidence", {}).get("raw_line") if isinstance(ev.get("evidence"), dict) else None,
                    )
                ]

                alert = DetectedAlert(
                    rule_id=self.rule_id,
                    rule_version=self.rule_version,
                    rule_name=self.rule_name,
                    severity=severity,
                    title=f"Privileged activity: {action_description}",
                    summary=(
                        f"Evidenced privileged activity detected: user '{username}' on host '{host_str}' "
                        f"(event type: {etype})."
                    ),
                    reason=(
                        f"Observed privileged event {etype} for account '{username}' at {occurred_at}. "
                        f"{action_description}."
                    ),
                    fingerprint=fingerprint,
                    first_event_at=occurred_at,
                    last_event_at=occurred_at,
                    event_count=1,
                    evidence_events=evidence_items,
                    metadata={
                        "username": username,
                        "source_host": host_str,
                        "source_ip": source_ip,
                        "action_description": action_description,
                        "event_type": etype,
                        "has_uncertain_timestamps": has_uncertain_ts,
                    },
                )
                alerts.append(alert)

        return alerts
