"""Self-check diagnostics for the sentinel_parser package."""

import sys
import json
from sentinel_parser.parser import parse_line
from sentinel_parser.models import EventType, SeverityLevel


def run_self_check() -> int:
    """Run parser self-check and return status code (0 for success)."""
    test_line = (
        "Oct 24 10:14:22 bastion-01 sshd[14201]: "
        "Accepted publickey for deploy from 192.0.2.10 port 49152 ssh2: RSA SHA256:abc123def456"
    )

    event = parse_line(test_line, line_number=1)

    if not event:
        print(json.dumps({
            "status": "error",
            "message": "Self-check failed: test line could not be parsed."
        }), file=sys.stderr)
        return 1

    validation_errors = event.validate()
    if validation_errors:
        print(json.dumps({
            "status": "error",
            "message": "Self-check failed: parsed event has validation errors.",
            "errors": validation_errors,
        }), file=sys.stderr)
        return 1

    assert event.event_type == EventType.SSH_LOGIN_SUCCESS.value
    assert event.severity == SeverityLevel.INFO.value
    assert event.username == "deploy"
    assert event.source_ip == "192.0.2.10"
    assert event.source_port == 49152
    assert event.process_name == "sshd"

    result = {
        "status": "ok",
        "service": "sentinel-parser",
        "version": "0.1.0",
        "checks": {
            "regex_compilation": "ok",
            "line_parser": "ok",
            "schema_validation": "ok",
            "timestamp_conversion": "ok",
        },
        "sample_event": {
            "id": event.id,
            "event_type": event.event_type,
            "username": event.username,
            "source_ip": event.source_ip,
            "occurred_at": event.occurred_at,
        }
    }

    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(run_self_check())

