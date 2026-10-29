"""
NomaanOS Sentinel — Detection Rules Registry
"""

from sentinel_parser.detection.rules.base import DetectionRule
from sentinel_parser.detection.rules.repeated_failures import RepeatedFailuresRule
from sentinel_parser.detection.rules.success_after_failures import SuccessAfterFailuresRule
from sentinel_parser.detection.rules.privileged_activity import PrivilegedActivityRule
from sentinel_parser.detection.rules.invalid_user_probing import InvalidUserProbingRule

__all__ = [
    "DetectionRule",
    "RepeatedFailuresRule",
    "SuccessAfterFailuresRule",
    "PrivilegedActivityRule",
    "InvalidUserProbingRule",
]

