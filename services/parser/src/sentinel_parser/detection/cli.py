"""
NomaanOS Sentinel — Detection Engine CLI
Entry point for evaluating normalized security events from files or stdin.
"""

import argparse
import json
import sys
from typing import Any, Dict, List
from sentinel_parser.detection.engine import DetectionEngine


def main() -> None:
    parser = argparse.ArgumentParser(
        description="NomaanOS Sentinel Deterministic Detection Engine CLI"
    )
    parser.add_argument(
        "input",
        help="Path to JSON file containing normalized security events, or '-' for stdin",
    )
    parser.add_argument(
        "--workspace-id",
        required=True,
        help="Workspace UUID / Tenant identifier for multi-tenant isolation",
    )
    args = parser.parse_args()

    try:
        if args.input == "-":
            raw_data = sys.stdin.read()
        else:
            with open(args.input, "r", encoding="utf-8") as f:
                raw_data = f.read()

        parsed = json.loads(raw_data)
        if isinstance(parsed, list):
            events = parsed
        elif isinstance(parsed, dict) and "events" in parsed:
            events = parsed["events"]
        else:
            raise ValueError("Input JSON must be an array of events or an object with an 'events' list")

        engine = DetectionEngine()
        alerts = engine.evaluate(events, workspace_id=args.workspace_id)

        output: Dict[str, Any] = {
            "workspace_id": args.workspace_id,
            "alert_count": len(alerts),
            "evaluated_events_count": len(events),
            "rules_evaluated": len(engine.rules),
            "alerts": [a.to_dict() for a in alerts],
        }

        print(json.dumps(output, indent=2))
        sys.exit(0)
    except Exception as exc:
        sys.stderr.write(f"DETECTION_CLI_ERROR: {str(exc)}\n")
        sys.exit(1)


if __name__ == "__main__":
    main()

