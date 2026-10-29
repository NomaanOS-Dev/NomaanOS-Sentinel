"""CLI entry point for sentinel_parser."""

import sys
import json
import argparse
from sentinel_parser.self_check import run_self_check
from sentinel_parser.parser import LinuxAuthParser
from sentinel_parser import __version__


def main():
    parser = argparse.ArgumentParser(
        prog="sentinel-parser",
        description="NomaanOS Sentinel Linux Authentication Log Parser",
    )
    parser.add_argument(
        "--self-check",
        action="store_true",
        help="Run parser self-check and output diagnostic JSON",
    )
    parser.add_argument(
        "--version",
        action="version",
        version=f"sentinel-parser {__version__}",
    )
    parser.add_argument(
        "file",
        nargs="?",
        help="Path to authentication log file to parse",
    )
    parser.add_argument(
        "--tenant-id",
        help="Optional tenant UUID to associate with parsed events",
    )

    args = parser.parse_args()

    if args.self_check:
        sys.exit(run_self_check())

    if not args.file:
        parser.print_help()
        sys.exit(0)

    auth_parser = LinuxAuthParser()
    try:
        summary = auth_parser.parse_file(args.file, tenant_id=args.tenant_id)
        output = {
            "file": args.file,
            "total_lines": summary.total_lines,
            "valid_count": summary.valid_count,
            "malformed_count": summary.malformed_count,
            "unsupported_count": summary.unsupported_count,
            "skipped_count": summary.skipped_count,
            "parser_version": summary.parser_version,
            "events": [e.to_dict() for e in summary.events],
        }
        print(json.dumps(output, indent=2))
        sys.exit(0)
    except Exception as ex:
        print(json.dumps({"error": str(ex)}), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()

