import os
from pathlib import Path
from sentinel_agent.collector import LogCollector


def test_collector_reads_new_lines_and_persists_checkpoint(tmp_path):
    log_file = tmp_path / "auth.log"
    chk_file = tmp_path / "checkpoint.json"

    # Write initial log line
    log_file.write_text(
        "Oct 27 10:00:00 ubuntu-prod sshd[1234]: Accepted publickey for ubuntu from 192.168.1.100 port 50000 ssh2\n",
        encoding="utf-8",
    )

    collector = LogCollector(
        log_path=str(log_file),
        checkpoint_path=str(chk_file),
        workspace_id="11111111-1111-1111-1111-111111111111",
        default_year=2026,
    )

    events = collector.collect_new_events()
    assert len(events) == 1
    assert events[0]["event_type"] == "ssh_login_success"
    assert events[0]["username"] == "ubuntu"
    assert events[0]["tenant_id"] == "11111111-1111-1111-1111-111111111111"
    assert events[0]["ingestion_source"] == "linux_agent"

    # Verify checkpoint exists
    assert chk_file.is_file()
    assert collector.current_offset > 0
    assert collector.line_number == 1

    # Second poll with no new lines returns empty list
    events2 = collector.collect_new_events()
    assert len(events2) == 0


def test_collector_handles_incomplete_partial_lines(tmp_path):
    log_file = tmp_path / "auth.log"
    chk_file = tmp_path / "checkpoint.json"

    collector = LogCollector(
        log_path=str(log_file),
        checkpoint_path=str(chk_file),
        workspace_id="11111111-1111-1111-1111-111111111111",
        default_year=2026,
    )

    # Write partial line WITHOUT trailing newline
    with open(log_file, "w", encoding="utf-8") as f:
        f.write("Oct 27 10:01:00 ubuntu-prod sshd[1234]: Failed password for invalid")

    # Incomplete line should NOT be parsed or committed
    events = collector.collect_new_events()
    assert len(events) == 0
    assert collector.partial_line != ""

    # Append remainder of the line WITH trailing newline
    with open(log_file, "a", encoding="utf-8") as f:
        f.write(" user admin from 10.0.0.1 port 4444 ssh2\n")

    events2 = collector.collect_new_events()
    assert len(events2) == 1
    assert events2[0]["event_type"] == "invalid_user_attempt"
    assert events2[0]["username"] == "admin"
    assert collector.partial_line == ""


def test_collector_detects_log_truncation(tmp_path):
    log_file = tmp_path / "auth.log"
    chk_file = tmp_path / "checkpoint.json"

    # Write long line
    log_file.write_text(
        "Oct 27 10:00:00 ubuntu-prod sshd[1234]: Accepted publickey for ubuntu from 192.168.1.100 port 50000 ssh2\n",
        encoding="utf-8",
    )

    collector = LogCollector(
        log_path=str(log_file),
        checkpoint_path=str(chk_file),
        workspace_id="11111111-1111-1111-1111-111111111111",
        default_year=2026,
    )
    events1 = collector.collect_new_events()
    assert len(events1) == 1
    old_offset = collector.current_offset

    # Truncate file and write shorter line
    log_file.write_text(
        "Oct 27 10:05:00 ubuntu-prod sudo: pam_unix(sudo:session): session opened for user root by (uid=1000)\n",
        encoding="utf-8",
    )

    # Collector should detect truncation and reset offset
    events2 = collector.collect_new_events()
    assert len(events2) == 1
    assert events2[0]["event_type"] == "session_opened"

