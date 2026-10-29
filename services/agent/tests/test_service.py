import json
import os
import stat
from sentinel_agent.config import AgentConfig
from sentinel_agent.service import AgentService


def test_service_initialization_and_diagnostics(tmp_path):
    log_file = tmp_path / "auth.log"
    log_file.write_text("", encoding="utf-8")
    cred_file = tmp_path / "credentials.json"
    cred_file.write_text(
        json.dumps({
            "agent_id": "test-agent-123",
            "agent_key": "secret-key-456",
            "integration_id": "int-789",
            "workspace_id": "00000000-0000-0000-0000-000000000000",
        }),
        encoding="utf-8",
    )
    if os.name == "posix":
        os.chmod(str(cred_file), stat.S_IRUSR | stat.S_IWUSR)

    cfg = AgentConfig(
        log_file=str(log_file),
        credentials_path=str(cred_file),
        buffer_path=str(tmp_path / "buffer.db"),
        checkpoint_path=str(tmp_path / "checkpoint.json"),
    )

    service = AgentService(cfg)
    diag = service.get_diagnostics()

    assert diag["status"] == "STOPPED"
    assert diag["is_enrolled"] is True
    assert diag["agent_id"] == "test-agent-123"
    assert diag["pending_buffer_events"] == 0
    assert "agent_key" not in diag  # Secrets strictly masked/omitted
    service.buffer.close()


def test_service_tick_collects_and_buffers_logs(tmp_path):
    log_file = tmp_path / "auth.log"
    log_file.write_text(
        "Oct 27 11:00:00 ubuntu-prod sshd[123]: Accepted publickey for ubuntu from 192.168.1.1 port 50000 ssh2\n",
        encoding="utf-8",
    )
    cred_file = tmp_path / "credentials.json"
    cred_file.write_text(
        json.dumps({
            "agent_id": "test-agent-123",
            "agent_key": "secret-key-456",
            "integration_id": "int-789",
            "workspace_id": "00000000-0000-0000-0000-000000000000",
        }),
        encoding="utf-8",
    )
    if os.name == "posix":
        os.chmod(str(cred_file), stat.S_IRUSR | stat.S_IWUSR)

    cfg = AgentConfig(
        log_file=str(log_file),
        credentials_path=str(cred_file),
        buffer_path=str(tmp_path / "buffer.db"),
        checkpoint_path=str(tmp_path / "checkpoint.json"),
    )

    service = AgentService(cfg)

    # Disable network client delivery in unit test by monkeypatching client to None
    service.client = None

    service.tick()

    # Verify event was ingested into buffer
    assert service.buffer.get_pending_count() == 1
    events = service.buffer.peek_batch(10)
    assert events[0]["event_type"] == "ssh_login_success"
    assert events[0]["username"] == "ubuntu"
    service.buffer.close()
