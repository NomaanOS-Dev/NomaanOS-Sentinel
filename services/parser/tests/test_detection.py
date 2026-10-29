"""
NomaanOS Sentinel — Deterministic Detection Engine Unit & Integration Tests
Tests all positive, negative, boundary, fingerprint, ordering, and workspace-isolation scenarios.
"""

import copy
import uuid
from datetime import datetime, timezone, timedelta
import pytest
from sentinel_parser.detection.engine import DetectionEngine
from sentinel_parser.detection.models import EventRole
from sentinel_parser.detection.fingerprint import compute_alert_fingerprint
from sentinel_parser.detection.rules.repeated_failures import RepeatedFailuresRule
from sentinel_parser.detection.rules.success_after_failures import SuccessAfterFailuresRule
from sentinel_parser.detection.rules.privileged_activity import PrivilegedActivityRule
from sentinel_parser.detection.rules.invalid_user_probing import InvalidUserProbingRule


def create_event(
    event_type: str,
    occurred_at: str,
    username: str = None,
    source_ip: str = None,
    severity: str = "info",
    source_host: str = "test-host",
    event_id: str = None,
    line_number: int = 1,
    timestamp_uncertain: bool = False,
) -> dict:
    return {
        "id": event_id or str(uuid.uuid4()),
        "schema_version": "1.0.0",
        "source_type": "linux_auth",
        "source_host": source_host,
        "event_type": event_type,
        "severity": severity,
        "occurred_at": occurred_at,
        "observed_at": occurred_at,
        "username": username,
        "source_ip": source_ip,
        "source_port": 22,
        "process_name": "sshd",
        "message": f"{event_type} for {username} from {source_ip}",
        "evidence": {
            "line_number": line_number,
            "raw_line": f"raw line {line_number}",
            "timestamp_uncertain": timestamp_uncertain,
        },
        "ingestion_source": "file_upload",
    }


class TestDetectionEngine:
    WORKSPACE_A = "11111111-1111-1111-1111-111111111111"
    WORKSPACE_B = "22222222-2222-2222-2222-222222222222"

    # =========================================================================
    # Rule A: Repeated Authentication Failures
    # =========================================================================

    def test_rule_a_positive_at_threshold(self):
        """Positive: Exactly 5 failures within 300s triggers repeated failures alert."""
        rule = RepeatedFailuresRule(threshold=5, window_seconds=300)
        base_time = datetime(2026, 10, 24, 12, 0, 0, tzinfo=timezone.utc)
        events = [
            create_event("ssh_login_failure", (base_time + timedelta(seconds=i * 30)).isoformat(), "alice", "192.168.1.50")
            for i in range(5)
        ]

        alerts = rule.evaluate(events, self.WORKSPACE_A)
        assert len(alerts) == 1
        a = alerts[0]
        assert a.rule_id == "AUTH_REPEATED_FAILURES"
        assert a.rule_version == "1.0.0"
        assert a.severity == "medium"
        assert a.event_count == 5
        assert len(a.evidence_events) == 5
        assert a.metadata["username"] == "alice"
        assert a.metadata["source_ip"] == "192.168.1.50"

    def test_rule_a_positive_high_severity(self):
        """Positive: 10 failures escalates severity to high."""
        rule = RepeatedFailuresRule(threshold=5, window_seconds=300)
        base_time = datetime(2026, 10, 24, 12, 0, 0, tzinfo=timezone.utc)
        events = [
            create_event("ssh_login_failure", (base_time + timedelta(seconds=i * 10)).isoformat(), "victim", "10.0.0.99")
            for i in range(10)
        ]

        alerts = rule.evaluate(events, self.WORKSPACE_A)
        assert len(alerts) == 1
        assert alerts[0].severity == "high"
        assert alerts[0].event_count == 10

    def test_rule_a_negative_below_threshold(self):
        """Negative: Exactly one below threshold (4 failures) produces no alert."""
        rule = RepeatedFailuresRule(threshold=5, window_seconds=300)
        base_time = datetime(2026, 10, 24, 12, 0, 0, tzinfo=timezone.utc)
        events = [
            create_event("ssh_login_failure", (base_time + timedelta(seconds=i * 20)).isoformat(), "bob", "192.168.1.50")
            for i in range(4)
        ]

        alerts = rule.evaluate(events, self.WORKSPACE_A)
        assert len(alerts) == 0

    def test_rule_a_boundary_window(self):
        """Boundary: 5th failure at exactly 300s triggers; 5th failure at 301s does not trigger."""
        rule = RepeatedFailuresRule(threshold=5, window_seconds=300)
        base_time = datetime(2026, 10, 24, 12, 0, 0, tzinfo=timezone.utc)

        # 5th failure at exactly 300s -> triggers
        events_in_boundary = [
            create_event("ssh_login_failure", (base_time + timedelta(seconds=0)).isoformat(), "user1", "1.1.1.1"),
            create_event("ssh_login_failure", (base_time + timedelta(seconds=50)).isoformat(), "user1", "1.1.1.1"),
            create_event("ssh_login_failure", (base_time + timedelta(seconds=100)).isoformat(), "user1", "1.1.1.1"),
            create_event("ssh_login_failure", (base_time + timedelta(seconds=200)).isoformat(), "user1", "1.1.1.1"),
            create_event("ssh_login_failure", (base_time + timedelta(seconds=300)).isoformat(), "user1", "1.1.1.1"),
        ]
        assert len(rule.evaluate(events_in_boundary, self.WORKSPACE_A)) == 1

        # 5th failure at 301s -> outside window -> fails to meet 5 within 300s
        events_outside_boundary = [
            create_event("ssh_login_failure", (base_time + timedelta(seconds=0)).isoformat(), "user2", "1.1.1.2"),
            create_event("ssh_login_failure", (base_time + timedelta(seconds=50)).isoformat(), "user2", "1.1.1.2"),
            create_event("ssh_login_failure", (base_time + timedelta(seconds=100)).isoformat(), "user2", "1.1.1.2"),
            create_event("ssh_login_failure", (base_time + timedelta(seconds=200)).isoformat(), "user2", "1.1.1.2"),
            create_event("ssh_login_failure", (base_time + timedelta(seconds=301)).isoformat(), "user2", "1.1.1.2"),
        ]
        assert len(rule.evaluate(events_outside_boundary, self.WORKSPACE_A)) == 0

    def test_rule_a_negative_missing_identifiers(self):
        """Negative: Missing username or missing source IP does not aggregate into account alerts."""
        rule = RepeatedFailuresRule(threshold=5, window_seconds=300)
        base_time = datetime(2026, 10, 24, 12, 0, 0, tzinfo=timezone.utc)

        # 5 failures with no username
        events_no_user = [
            create_event("ssh_login_failure", (base_time + timedelta(seconds=i * 10)).isoformat(), None, "1.2.3.4")
            for i in range(5)
        ]
        assert len(rule.evaluate(events_no_user, self.WORKSPACE_A)) == 0

        # 5 failures with no source IP
        events_no_ip = [
            create_event("ssh_login_failure", (base_time + timedelta(seconds=i * 10)).isoformat(), "root", None)
            for i in range(5)
        ]
        assert len(rule.evaluate(events_no_ip, self.WORKSPACE_A)) == 0

    def test_rule_a_negative_unrelated_accounts_not_combined(self):
        """Negative: Failures on different accounts or different IPs are not conflated."""
        rule = RepeatedFailuresRule(threshold=5, window_seconds=300)
        base_time = datetime(2026, 10, 24, 12, 0, 0, tzinfo=timezone.utc)

        # 3 failures for userA, 3 failures for userB (total 6, but max 3 per user)
        events = [
            create_event("ssh_login_failure", (base_time + timedelta(seconds=10)).isoformat(), "userA", "10.0.0.1"),
            create_event("ssh_login_failure", (base_time + timedelta(seconds=20)).isoformat(), "userB", "10.0.0.1"),
            create_event("ssh_login_failure", (base_time + timedelta(seconds=30)).isoformat(), "userA", "10.0.0.1"),
            create_event("ssh_login_failure", (base_time + timedelta(seconds=40)).isoformat(), "userB", "10.0.0.1"),
            create_event("ssh_login_failure", (base_time + timedelta(seconds=50)).isoformat(), "userA", "10.0.0.1"),
            create_event("ssh_login_failure", (base_time + timedelta(seconds=60)).isoformat(), "userB", "10.0.0.1"),
        ]
        assert len(rule.evaluate(events, self.WORKSPACE_A)) == 0

    # =========================================================================
    # Rule B: Successful Authentication Following Repeated Failures
    # =========================================================================

    def test_rule_b_positive(self):
        """Positive: 3 failures followed by a success within 600s triggers alert."""
        rule = SuccessAfterFailuresRule(failure_threshold=3, window_seconds=600)
        base_time = datetime(2026, 10, 24, 14, 0, 0, tzinfo=timezone.utc)

        success_id = str(uuid.uuid4())
        events = [
            create_event("ssh_login_failure", (base_time + timedelta(seconds=0)).isoformat(), "admin", "198.51.100.5"),
            create_event("ssh_login_failure", (base_time + timedelta(seconds=60)).isoformat(), "admin", "198.51.100.5"),
            create_event("ssh_login_failure", (base_time + timedelta(seconds=120)).isoformat(), "admin", "198.51.100.5"),
            create_event("ssh_login_success", (base_time + timedelta(seconds=180)).isoformat(), "admin", "198.51.100.5", event_id=success_id),
        ]

        alerts = rule.evaluate(events, self.WORKSPACE_A)
        assert len(alerts) == 1
        a = alerts[0]
        assert a.rule_id == "AUTH_SUCCESS_AFTER_FAILURES"
        assert a.severity == "high"
        assert a.event_count == 4
        # Verify evidence roles
        roles = [e.role for e in a.evidence_events]
        assert roles.count(EventRole.PRECEDING_FAILURE.value) == 3
        assert roles.count(EventRole.SUBSEQUENT_SUCCESS.value) == 1

    def test_rule_b_negative_insufficient_failures(self):
        """Negative: Only 2 failures preceding success (below threshold 3) does not trigger."""
        rule = SuccessAfterFailuresRule(failure_threshold=3, window_seconds=600)
        base_time = datetime(2026, 10, 24, 14, 0, 0, tzinfo=timezone.utc)

        events = [
            create_event("ssh_login_failure", (base_time + timedelta(seconds=0)).isoformat(), "deploy", "10.10.10.10"),
            create_event("ssh_login_failure", (base_time + timedelta(seconds=60)).isoformat(), "deploy", "10.10.10.10"),
            create_event("ssh_login_success", (base_time + timedelta(seconds=120)).isoformat(), "deploy", "10.10.10.10"),
        ]
        assert len(rule.evaluate(events, self.WORKSPACE_A)) == 0

    def test_rule_b_negative_success_before_failures(self):
        """Negative: Failures occurring AFTER success do not trigger success-after-failures."""
        rule = SuccessAfterFailuresRule(failure_threshold=3, window_seconds=600)
        base_time = datetime(2026, 10, 24, 14, 0, 0, tzinfo=timezone.utc)

        events = [
            create_event("ssh_login_success", (base_time + timedelta(seconds=0)).isoformat(), "dev", "10.10.10.20"),
            create_event("ssh_login_failure", (base_time + timedelta(seconds=60)).isoformat(), "dev", "10.10.10.20"),
            create_event("ssh_login_failure", (base_time + timedelta(seconds=120)).isoformat(), "dev", "10.10.10.20"),
            create_event("ssh_login_failure", (base_time + timedelta(seconds=180)).isoformat(), "dev", "10.10.10.20"),
        ]
        assert len(rule.evaluate(events, self.WORKSPACE_A)) == 0

    def test_rule_b_negative_different_ip_not_correlated(self):
        """Negative: Failures from IP A followed by success from IP B are not correlated."""
        rule = SuccessAfterFailuresRule(failure_threshold=3, window_seconds=600)
        base_time = datetime(2026, 10, 24, 14, 0, 0, tzinfo=timezone.utc)

        events = [
            create_event("ssh_login_failure", (base_time + timedelta(seconds=0)).isoformat(), "alice", "192.168.1.1"),
            create_event("ssh_login_failure", (base_time + timedelta(seconds=60)).isoformat(), "alice", "192.168.1.1"),
            create_event("ssh_login_failure", (base_time + timedelta(seconds=120)).isoformat(), "alice", "192.168.1.1"),
            create_event("ssh_login_success", (base_time + timedelta(seconds=180)).isoformat(), "alice", "192.168.1.200"),
        ]
        assert len(rule.evaluate(events, self.WORKSPACE_A)) == 0

    # =========================================================================
    # Rule C: Supported Privileged-Account Activity
    # =========================================================================

    def test_rule_c_positive_direct_root_login(self):
        """Positive: Direct SSH root login generates privileged activity alert."""
        rule = PrivilegedActivityRule()
        ts = "2026-10-24T16:00:00+00:00"

        # External IP -> high severity
        ev_external = create_event("ssh_login_success", ts, username="root", source_ip="203.0.113.195")
        alerts_ext = rule.evaluate([ev_external], self.WORKSPACE_A)
        assert len(alerts_ext) == 1
        assert alerts_ext[0].severity == "high"
        assert alerts_ext[0].rule_id == "PRIV_ACCOUNT_ACTIVITY"

        # Internal/loopback IP -> medium severity
        ev_internal = create_event("ssh_login_success", ts, username="root", source_ip="127.0.0.1")
        alerts_int = rule.evaluate([ev_internal], self.WORKSPACE_A)
        assert len(alerts_int) == 1
        assert alerts_int[0].severity == "medium"

    def test_rule_c_positive_sudo_command(self):
        """Positive: Sudo command execution produces privileged activity alert."""
        rule = PrivilegedActivityRule()
        ev = create_event("sudo_command", "2026-10-24T16:05:00+00:00", username="ubuntu")
        alerts = rule.evaluate([ev], self.WORKSPACE_A)
        assert len(alerts) == 1
        assert alerts[0].severity == "medium"
        assert alerts[0].evidence_events[0].role == EventRole.PRIVILEGED_ACTION.value

    def test_rule_c_negative_non_privileged_account(self):
        """Negative: Non-root user login (e.g. ubuntu, admin) does not trigger privileged rule."""
        rule = PrivilegedActivityRule()
        # Normal user login
        ev1 = create_event("ssh_login_success", "2026-10-24T16:10:00+00:00", username="ubuntu", source_ip="10.0.0.5")
        # User named 'admin' is NOT assumed to be root
        ev2 = create_event("ssh_login_success", "2026-10-24T16:10:05+00:00", username="admin", source_ip="10.0.0.5")
        assert len(rule.evaluate([ev1, ev2], self.WORKSPACE_A)) == 0

    # =========================================================================
    # Rule D: Invalid User Probing
    # =========================================================================

    def test_rule_d_positive(self):
        """Positive: 3 invalid user attempts from same IP within 300s triggers alert."""
        rule = InvalidUserProbingRule(threshold=3, window_seconds=300)
        base_time = datetime(2026, 10, 24, 18, 0, 0, tzinfo=timezone.utc)
        events = [
            create_event("invalid_user_attempt", (base_time + timedelta(seconds=10)).isoformat(), "guest", "203.0.113.88"),
            create_event("invalid_user_attempt", (base_time + timedelta(seconds=20)).isoformat(), "postgres", "203.0.113.88"),
            create_event("invalid_user_attempt", (base_time + timedelta(seconds=30)).isoformat(), "oracle", "203.0.113.88"),
        ]
        alerts = rule.evaluate(events, self.WORKSPACE_A)
        assert len(alerts) == 1
        assert alerts[0].rule_id == "AUTH_INVALID_USER_PROBING"
        assert alerts[0].event_count == 3
        assert alerts[0].metadata["source_ip"] == "203.0.113.88"

    # =========================================================================
    # Fingerprint, Reprocessing & Workspace Isolation
    # =========================================================================

    def test_fingerprint_deterministic_and_idempotent(self):
        """Fingerprints are strictly deterministic across identical runs."""
        fp1 = compute_alert_fingerprint("AUTH_REPEATED_FAILURES", "1.0.0", self.WORKSPACE_A, ["alice", "10.0.0.1"], ["id1", "id2"])
        fp2 = compute_alert_fingerprint("AUTH_REPEATED_FAILURES", "1.0.0", self.WORKSPACE_A, ["alice", "10.0.0.1"], ["id1", "id2"])
        assert fp1 == fp2

    def test_fingerprint_differs_on_rule_version(self):
        """Changing rule version changes the alert fingerprint."""
        fp_v1 = compute_alert_fingerprint("AUTH_REPEATED_FAILURES", "1.0.0", self.WORKSPACE_A, ["alice", "10.0.0.1"], ["id1", "id2"])
        fp_v2 = compute_alert_fingerprint("AUTH_REPEATED_FAILURES", "1.1.0", self.WORKSPACE_A, ["alice", "10.0.0.1"], ["id1", "id2"])
        assert fp_v1 != fp_v2

    def test_workspace_isolation_fingerprint(self):
        """Different workspaces generate different fingerprints for identical telemetry."""
        fp_ws_a = compute_alert_fingerprint("AUTH_REPEATED_FAILURES", "1.0.0", self.WORKSPACE_A, ["alice", "10.0.0.1"], ["id1", "id2"])
        fp_ws_b = compute_alert_fingerprint("AUTH_REPEATED_FAILURES", "1.0.0", self.WORKSPACE_B, ["alice", "10.0.0.1"], ["id1", "id2"])
        assert fp_ws_a != fp_ws_b

    def test_chronological_ordering_robustness(self):
        """Out-of-order events are sorted stably and produce identical alerts."""
        engine = DetectionEngine()
        base_time = datetime(2026, 10, 24, 20, 0, 0, tzinfo=timezone.utc)

        events_ordered = [
            create_event("ssh_login_failure", (base_time + timedelta(seconds=i * 20)).isoformat(), "root", "192.168.1.100")
            for i in range(5)
        ]
        events_shuffled = copy.deepcopy(events_ordered)
        events_shuffled.reverse()

        alerts_1 = engine.evaluate(events_ordered, self.WORKSPACE_A)
        alerts_2 = engine.evaluate(events_shuffled, self.WORKSPACE_A)

        assert len(alerts_1) == len(alerts_2) == 1
        assert alerts_1[0].fingerprint == alerts_2[0].fingerprint
        assert alerts_1[0].first_event_at == alerts_2[0].first_event_at

    def test_timestamp_uncertainty_flagging(self):
        """Events with uncertain timestamps record has_uncertain_timestamps in alert metadata."""
        engine = DetectionEngine()
        base_time = datetime(2026, 10, 24, 21, 0, 0, tzinfo=timezone.utc)

        events = [
            create_event("ssh_login_failure", (base_time + timedelta(seconds=i * 10)).isoformat(), "user_x", "192.168.5.5", timestamp_uncertain=True)
            for i in range(5)
        ]
        alerts = engine.evaluate(events, self.WORKSPACE_A)
        assert len(alerts) == 1
        assert alerts[0].metadata["has_uncertain_timestamps"] is True

    def test_empty_and_irrelevant_input(self):
        """Empty or irrelevant event streams produce 0 alerts without error."""
        engine = DetectionEngine()
        assert engine.evaluate([], self.WORKSPACE_A) == []

        irrelevant = [
            create_event("session_closed", "2026-10-24T22:00:00+00:00", username="cron"),
        ]
        assert engine.evaluate(irrelevant, self.WORKSPACE_A) == []

