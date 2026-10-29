"""
NomaanOS Sentinel — Detection Engine Package
Deterministic, versioned security detection engine.
"""

from sentinel_parser.detection.models import DetectedAlert, AlertEvidence, EventRole
from sentinel_parser.detection.fingerprint import compute_alert_fingerprint
from sentinel_parser.detection.rules.base import DetectionRule
from sentinel_parser.detection.rules.repeated_failures import RepeatedFailuresRule
from sentinel_parser.detection.rules.success_after_failures import SuccessAfterFailuresRule
from sentinel_parser.detection.rules.privileged_activity import PrivilegedActivityRule
from sentinel_parser.detection.rules.invalid_user_probing import InvalidUserProbingRule
from sentinel_parser.detection.engine import DetectionEngine

__all__ = [
    "DetectedAlert",
    "AlertEvidence",
    "EventRole",
    "compute_alert_fingerprint",
    "DetectionRule",
    "RepeatedFailuresRule",
    "SuccessAfterFailuresRule",
    "PrivilegedActivityRule",
    "InvalidUserProbingRule",
    "DetectionEngine",
]

