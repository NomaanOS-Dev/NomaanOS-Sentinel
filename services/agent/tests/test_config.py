import json
import os
import stat
from pathlib import Path
import pytest

from sentinel_agent.config import (
    AgentConfig,
    mask_secret,
    InsecurePermissionsError,
    DEFAULT_API_URL,
    DEFAULT_LOG_FILE,
)


def test_default_config(tmp_path, monkeypatch):
    monkeypatch.setenv("SENTINEL_CONFIG_DIR", str(tmp_path))
    cfg = AgentConfig()
    assert cfg.api_url == DEFAULT_API_URL
    assert cfg.log_file == DEFAULT_LOG_FILE
    assert cfg.batch_size == 50
    assert cfg.max_buffer_bytes == 50 * 1024 * 1024
    assert not cfg.is_enrolled()


def test_env_var_overrides(monkeypatch):
    monkeypatch.setenv("SENTINEL_API_URL", "http://sentinel.internal:5000")
    monkeypatch.setenv("SENTINEL_LOG_FILE", "/custom/auth.log")
    monkeypatch.setenv("SENTINEL_BATCH_SIZE", "75")
    monkeypatch.setenv("SENTINEL_MAX_BUFFER_BYTES", "10485760")

    cfg = AgentConfig.load()
    assert cfg.api_url == "http://sentinel.internal:5000"
    assert cfg.log_file == "/custom/auth.log"
    assert cfg.batch_size == 75
    assert cfg.max_buffer_bytes == 10485760


def test_mask_secret():
    assert mask_secret(None) == ""
    assert mask_secret("") == ""
    assert mask_secret("short") == "********"
    masked = mask_secret("sentinel_key_abcdef1234567890")
    assert masked.startswith("sent")
    assert masked.endswith("7890")
    assert "abcdef" not in masked


def test_to_safe_dict_masks_secrets():
    cfg = AgentConfig(
        agent_id="test-agent-id",
        agent_key="super_secret_agent_key_value_123",
        workspace_id="test-workspace-id",
    )
    safe = cfg.to_safe_dict()
    assert safe["agent_id"] == "test-agent-id"
    assert "super_secret_agent_key_value_123" not in safe["agent_key"]
    assert "********" in safe["agent_key"]


def test_load_credentials_from_file(tmp_path):
    cred_file = tmp_path / "credentials.json"
    cred_file.write_text(
        json.dumps({
            "agent_id": "agent-uuid-1",
            "agent_key": "secret-key-1",
            "integration_id": "integration-uuid-1",
            "workspace_id": "workspace-uuid-1",
        }),
        encoding="utf-8",
    )
    if os.name == "posix":
        os.chmod(str(cred_file), stat.S_IRUSR | stat.S_IWUSR)

    cfg = AgentConfig(credentials_path=str(cred_file))
    assert cfg.is_enrolled()
    assert cfg.agent_id == "agent-uuid-1"
    assert cfg.agent_key == "secret-key-1"
    assert cfg.workspace_id == "workspace-uuid-1"


@pytest.mark.skipif(os.name != "posix", reason="POSIX permission checks only apply on Unix/Linux")
def test_insecure_permissions_rejected_on_posix(tmp_path):
    cred_file = tmp_path / "credentials.json"
    cred_file.write_text(json.dumps({"agent_id": "id", "agent_key": "k"}), encoding="utf-8")

    # Set world-readable permissions (0666)
    os.chmod(str(cred_file), stat.S_IRUSR | stat.S_IWUSR | stat.S_IROTH | stat.S_IWOTH)

    with pytest.raises(InsecurePermissionsError):
        AgentConfig(credentials_path=str(cred_file))

    cfg = AgentConfig(credentials_path="/nonexistent/path/credentials.json")
    cfg.credentials_path = str(cred_file)
    with pytest.raises(InsecurePermissionsError):
        cfg.load_credentials()

