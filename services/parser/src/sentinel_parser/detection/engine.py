"""
NomaanOS Sentinel — Deterministic Detection Engine Core
Evaluates normalized security events against versioned, explicit detection rules.
"""

from typing import Any, Dict, List, Optional, Union
from sentinel_parser.models import NormalizedSecurityEvent
from sentinel_parser.detection.models import DetectedAlert
from sentinel_parser.detection.rules.base import DetectionRule
from sentinel_parser.detection.rules.repeated_failures import RepeatedFailuresRule
from sentinel_parser.detection.rules.success_after_failures import SuccessAfterFailuresRule
from sentinel_parser.detection.rules.privileged_activity import PrivilegedActivityRule
from sentinel_parser.detection.rules.invalid_user_probing import InvalidUserProbingRule


class DetectionEngine:
    """
    Deterministic detection engine.
    Orchestrates registered detection rules without LLM dependencies.
    """

    def __init__(self, rules: Optional[List[DetectionRule]] = None):
        if rules is not None:
            self.rules = rules
        else:
            self.rules = [
                RepeatedFailuresRule(threshold=5, window_seconds=300),
                SuccessAfterFailuresRule(failure_threshold=3, window_seconds=600),
                PrivilegedActivityRule(),
                InvalidUserProbingRule(threshold=3, window_seconds=300),
            ]

    def add_rule(self, rule: DetectionRule) -> None:
        self.rules.append(rule)

    @staticmethod
    def _normalize_event(ev: Union[Dict[str, Any], NormalizedSecurityEvent]) -> Dict[str, Any]:
        """Converts NormalizedSecurityEvent or dict into standard dict format."""
        if isinstance(ev, NormalizedSecurityEvent):
            return ev.to_dict()
        elif isinstance(ev, dict):
            return ev
        else:
            raise TypeError(f"Unsupported event object type: {type(ev)}")

    def evaluate(
        self,
        events: List[Union[Dict[str, Any], NormalizedSecurityEvent]],
        workspace_id: str,
    ) -> List[DetectedAlert]:
        """
        Evaluates a collection of normalized events for a given workspace.

        Guarantees:
        - Deterministic execution: identical inputs produce identical alerts in identical order.
        - Strict tenant isolation: workspace_id is bound to all generated alert fingerprints.
        - Deduplication: alerts with identical fingerprints within the evaluation batch are merged or preserved.
        """
        if not events:
            return []

        dict_events = [self._normalize_event(e) for e in events]
        all_alerts: List[DetectedAlert] = []
        seen_fingerprints = set()

        for rule in self.rules:
            rule_alerts = rule.evaluate(dict_events, workspace_id)
            for alert in rule_alerts:
                if alert.fingerprint not in seen_fingerprints:
                    seen_fingerprints.add(alert.fingerprint)
                    all_alerts.append(alert)

        # Stable deterministic sorting of output alerts
        def alert_sort_key(a: DetectedAlert):
            return (a.first_event_at, a.rule_id, a.fingerprint)

        all_alerts.sort(key=alert_sort_key)
        return all_alerts

