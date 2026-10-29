"""Validate parser output against canonical JSON Schema."""

import os
import json
import unittest
from jsonschema import validate, ValidationError
from sentinel_parser.parser import LinuxAuthParser
from sentinel_parser.models import NormalizedSecurityEvent


class TestSchemaCompliance(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        schema_path = os.path.abspath(
            os.path.join(
                os.path.dirname(__file__),
                "../../../database/schema/security-event.schema.json",
            )
        )
        with open(schema_path, "r", encoding="utf-8") as f:
            cls.schema = json.load(f)
        cls.parser = LinuxAuthParser(default_year=2026)

    def test_parsed_event_matches_json_schema(self):
        line = (
            "Oct 24 10:14:22 bastion-01 sshd[14201]: "
            "Accepted publickey for deploy from 192.0.2.10 port 49152 ssh2: RSA SHA256:abc123def456"
        )
        event = self.parser.parse_line(line)
        self.assertIsNotNone(event)
        event_dict = event.to_dict()

        # Validate against official Draft 2020-12 schema
        validate(instance=event_dict, schema=self.schema)

    def test_schema_rejects_invalid_severity(self):
        event = NormalizedSecurityEvent(
            severity="catastrophic",
            message="Test message",
        )
        event_dict = event.to_dict()

        with self.assertRaises(ValidationError):
            validate(instance=event_dict, schema=self.schema)

    def test_schema_rejects_missing_required_field(self):
        event = NormalizedSecurityEvent(message="Test message")
        event_dict = event.to_dict()
        del event_dict["event_type"]

        with self.assertRaises(ValidationError):
            validate(instance=event_dict, schema=self.schema)


if __name__ == "__main__":
    unittest.main()

