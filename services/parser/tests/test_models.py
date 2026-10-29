"""Unit tests for NormalizedSecurityEvent model validation."""

import unittest
from sentinel_parser.models import (
    NormalizedSecurityEvent,
    EventType,
    SeverityLevel,
)


class TestModels(unittest.TestCase):
    def test_valid_default_event(self):
        event = NormalizedSecurityEvent(
            event_type=EventType.SSH_LOGIN_SUCCESS.value,
            severity=SeverityLevel.INFO.value,
            message="Valid message",
        )
        errors = event.validate()
        self.assertEqual(errors, [])

    def test_invalid_uuid(self):
        event = NormalizedSecurityEvent(
            id="not-a-uuid",
            message="Test message",
        )
        errors = event.validate()
        self.assertTrue(any("Invalid UUID" in e for e in errors))

    def test_invalid_severity(self):
        event = NormalizedSecurityEvent(
            severity="extreme",
            message="Test message",
        )
        errors = event.validate()
        self.assertTrue(any("Invalid severity" in e for e in errors))

    def test_invalid_port_range(self):
        event = NormalizedSecurityEvent(
            source_port=70000,
            message="Test message",
        )
        errors = event.validate()
        self.assertTrue(any("source_port out of bounds" in e for e in errors))

    def test_message_length_bound(self):
        event = NormalizedSecurityEvent(
            message="A" * 3000,
        )
        errors = event.validate()
        self.assertTrue(any("Message length exceeds 2048" in e for e in errors))


if __name__ == "__main__":
    unittest.main()

