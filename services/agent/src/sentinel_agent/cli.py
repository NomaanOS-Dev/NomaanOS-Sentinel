"""
NomaanOS Sentinel — Linux Monitoring Agent CLI Entrypoint.
"""

import argparse
import json
import logging
import sys
from pathlib import Path

from sentinel_agent import __version__
from sentinel_agent.config import AgentConfig, InsecurePermissionsError
from sentinel_agent.enrollment import enroll_agent, EnrollmentError
from sentinel_agent.service import AgentService

# Configure logging format
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("sentinel_agent.cli")


def cmd_enroll(args: argparse.Namespace) -> int:
    """Execute enrollment handshake with token."""
    config = AgentConfig.load(config_path=args.config)
    api_url = args.api_url or config.api_url

    print("==================================================")
    print(" NomaanOS Sentinel — Agent Enrollment")
    print("==================================================")
    print(f"Target API Server: {api_url}")
    print(f"Credentials Destination: {config.credentials_path}")

    try:
        result = enroll_agent(
            token=args.token,
            api_url=api_url,
            credentials_path=config.credentials_path,
        )
        print("\n[SUCCESS] Agent enrolled successfully!")
        print(f"  Agent ID:       {result['agent_id']}")
        print(f"  Workspace ID:   {result['workspace_id']}")
        print(f"  Integration ID: {result['integration_id']}")
        print(f"  Credentials:    {result['credentials_path']}")
        print("\nYou can now start the agent service:")
        print("  sentinel-agent start")
        print("or enable the systemd unit:")
        print("  sudo systemctl enable --now nomaanos-sentinel-agent")
        return 0
    except EnrollmentError as e:
        print(f"\n[ERROR] Enrollment failed: {e}", file=sys.stderr)
        return 1
    except Exception as e:
        print(f"\n[ERROR] Unexpected error: {e}", file=sys.stderr)
        return 1


def cmd_start(args: argparse.Namespace) -> int:
    """Start foreground agent service."""
    try:
        config = AgentConfig.load(config_path=args.config)
    except InsecurePermissionsError as e:
        print(f"[FATAL] Security Error: {e}", file=sys.stderr)
        return 2

    if not config.is_enrolled():
        print(
            "[ERROR] Agent credentials not found. Run 'sentinel-agent enroll --token <token>' first.",
            file=sys.stderr,
        )
        return 1

    service = AgentService(config)
    try:
        service.start()
        return 0
    except Exception as e:
        logger.exception(f"Agent service encountered fatal error: {e}")
        return 1


def cmd_status(args: argparse.Namespace) -> int:
    """Report agent configuration and operational status."""
    try:
        config = AgentConfig.load(config_path=args.config)
    except InsecurePermissionsError as e:
        print(f"[SECURITY ALERT] {e}")
        return 2

    service = AgentService(config)
    diag = service.get_diagnostics()

    print("==================================================")
    print(f" NomaanOS Sentinel Agent v{__version__} Status")
    print("==================================================")
    print(f"Enrolled:            {'YES' if diag['is_enrolled'] else 'NO'}")
    if diag["is_enrolled"]:
        print(f"Agent ID:            {diag['agent_id']}")
        print(f"Workspace ID:        {diag['workspace_id']}")
        print(f"Integration ID:      {diag['integration_id']}")
    print(f"API URL:             {diag['api_url']}")
    print(f"Target Log File:     {diag['log_file']} ({'exists' if Path(diag['log_file']).exists() else 'missing'})")
    print(f"Pending Buffer:      {diag['pending_buffer_events']} events")
    print(f"Buffer Storage:      {diag['buffer_storage_bytes']} bytes")
    print(f"Current Log Inode:   {diag['current_inode']}")
    print(f"Current Log Offset:  {diag['current_offset']} bytes")
    print(f"Lines Processed:     {diag['line_number']}")

    # Try heartbeat test if enrolled
    if service.client:
        print("\nTesting API Connectivity...")
        try:
            ok = service.client.send_heartbeat()
            print(f"Heartbeat Check:     {'PASS' if ok else 'FAIL'}")
        except Exception as e:
            print(f"Heartbeat Check:     FAIL ({e})")

    return 0


def cmd_test_log(args: argparse.Namespace) -> int:
    """Append simulated authentication log line(s) to the target log file for end-to-end verification."""
    from datetime import datetime, timezone
    import re

    config = AgentConfig.load(config_path=args.config)
    target_file = args.file or config.log_file

    now = datetime.now(timezone.utc)
    now_str = now.strftime("%b %d %H:%M:%S")
    hostname = "sentinel-host"
    lines_to_write = []

    scenario = getattr(args, "scenario", None)
    count = getattr(args, "count", None)

    if scenario == "root-login":
        # Immediate High Severity Privileged Account Activity Alert
        total = count or 1
        for i in range(total):
            lines_to_write.append(
                f"{now_str} {hostname} sshd[{12345 + i}]: Accepted password for root from 198.51.100.42 port {52000 + i} ssh2"
            )
    elif scenario == "sudo":
        total = count or 1
        for i in range(total):
            lines_to_write.append(
                f"{now_str} {hostname} sudo: pam_unix(sudo:session): session opened for user root(uid=0) by ubuntu(uid=1000)"
            )
    elif scenario == "invalid-user":
        total = count or 5
        for i in range(total):
            lines_to_write.append(
                f"{now_str} {hostname} sshd[{12340 + i}]: Failed password for invalid user hacker{i} from 198.51.100.42 port {50000 + i} ssh2"
            )
    elif scenario == "brute-force":
        # 5+ failed attempts for same user & source IP within window triggers AUTH_REPEATED_FAILURES
        total = count if count and count >= 5 else 5
        for i in range(total):
            lines_to_write.append(
                f"{now_str} {hostname} sshd[{12340 + i}]: Failed password for root from 198.51.100.42 port {50000 + i} ssh2"
            )
    elif args.message:
        raw = args.message.strip()
        # Check if raw string already has a syslog header (e.g. "Oct 28 12:00:00 host proc: ...")
        syslog_pattern = re.compile(r"^[A-Z][a-z]{2}\s+\d+\s+\d{2}:\d{2}:\d{2}\s+")
        iso_pattern = re.compile(r"^\d{4}-\d{2}-\d{2}T")
        is_formatted = bool(syslog_pattern.match(raw) or iso_pattern.match(raw))

        total = count or 1
        for i in range(total):
            if is_formatted:
                lines_to_write.append(raw)
            else:
                lines_to_write.append(f"{now_str} {hostname} sshd[{12340 + i}]: {raw}")
    else:
        # Default: generate 5 brute force failure attempts to trigger both events and alert
        total = count if count and count >= 5 else 5
        for i in range(total):
            lines_to_write.append(
                f"{now_str} {hostname} sshd[{12340 + i}]: Failed password for root from 198.51.100.42 port {50000 + i} ssh2"
            )

    p = Path(target_file)
    try:
        p.parent.mkdir(parents=True, exist_ok=True)
        with open(p, "a", encoding="utf-8") as f:
            for line in lines_to_write:
                f.write(line.rstrip("\n") + "\n")
        print(f"[SUCCESS] Appended {len(lines_to_write)} valid syslog line(s) to '{target_file}':")
        for line in lines_to_write:
            print(f"  {line}")
        print("\nEnsure the agent service is running ('sentinel-agent start') to ingest these events.")
        return 0
    except Exception as e:
        print(f"[ERROR] Could not write to '{target_file}': {e}", file=sys.stderr)
        return 1


def main() -> None:
    parser = argparse.ArgumentParser(
        prog="sentinel-agent",
        description="NomaanOS Sentinel Linux Monitoring Agent",
    )
    parser.add_argument(
        "--version", action="version", version=f"%(prog)s {__version__}"
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    # 1. Enroll command
    p_enroll = subparsers.add_parser("enroll", help="Enroll agent with single-use token")
    p_enroll.add_argument("--token", required=True, help="Single-use enrollment token")
    p_enroll.add_argument("--api-url", help="Sentinel API base URL (e.g. http://sentinel.local:4000)")
    p_enroll.add_argument("--config", help="Path to custom agent configuration JSON")
    p_enroll.set_defaults(func=cmd_enroll)

    # 2. Start command
    p_start = subparsers.add_parser("start", help="Start agent service in foreground")
    p_start.add_argument("--config", help="Path to custom agent configuration JSON")
    p_start.set_defaults(func=cmd_start)

    # 3. Status command
    p_status = subparsers.add_parser("status", help="Display agent operational status and diagnostics")
    p_status.add_argument("--config", help="Path to custom agent configuration JSON")
    p_status.set_defaults(func=cmd_status)

    # 4. Test Log command
    p_test = subparsers.add_parser("test-log", help="Append simulated auth log entry for verification")
    p_test.add_argument(
        "--scenario",
        choices=["brute-force", "root-login", "sudo", "invalid-user"],
        help="Predefined scenario to trigger detections ('brute-force', 'root-login', etc.)",
    )
    p_test.add_argument("--count", type=int, help="Number of log lines to generate")
    p_test.add_argument("--message", help="Custom log string to append (auto-prefixes syslog header if missing)")
    p_test.add_argument("--file", help="Override destination log file path")
    p_test.add_argument("--config", help="Path to custom agent configuration JSON")
    p_test.set_defaults(func=cmd_test_log)

    args = parser.parse_args()
    code = args.func(args)
    sys.exit(code)


if __name__ == "__main__":
    main()

