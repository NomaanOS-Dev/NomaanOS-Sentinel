"""
NomaanOS Sentinel — Linux Agent Configuration Management.
"""

import json
import os
import stat
import logging
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Optional, Dict, Any

logger = logging.getLogger("sentinel_agent.config")

DEFAULT_CONFIG_DIR = "/etc/nomaanos-sentinel"
DEFAULT_STATE_DIR = "/var/lib/nomaanos-sentinel"
DEFAULT_API_URL = "http://localhost:4000"
DEFAULT_LOG_FILE = "/var/log/auth.log"
DEFAULT_MAX_BUFFER_BYTES = 50 * 1024 * 1024  # 50 MB
DEFAULT_BATCH_SIZE = 50
DEFAULT_BATCH_TIMEOUT_SECS = 5.0
DEFAULT_POLL_INTERVAL_SECS = 1.0
DEFAULT_HEARTBEAT_INTERVAL_SECS = 60.0
DEFAULT_MAX_RETRY_BACKOFF_SECS = 60.0
DEFAULT_INITIAL_RETRY_BACKOFF_SECS = 1.0


class InsecurePermissionsError(Exception):
    """Raised when critical credential files have overly permissive access permissions."""
    pass


def mask_secret(secret: Optional[str]) -> str:
    """Mask sensitive tokens or keys for safe display and logging."""
    if not secret:
        return ""
    if len(secret) <= 8:
        return "********"
    return secret[:4] + "********" + secret[-4:]


@dataclass
class AgentConfig:
    api_url: str = DEFAULT_API_URL
    log_file: str = DEFAULT_LOG_FILE
    config_dir: str = field(default_factory=lambda: os.environ.get("SENTINEL_CONFIG_DIR", DEFAULT_CONFIG_DIR))
    state_dir: str = field(default_factory=lambda: os.environ.get("SENTINEL_STATE_DIR", DEFAULT_STATE_DIR))
    credentials_path: str = field(default="")
    checkpoint_path: str = field(default="")
    buffer_path: str = field(default="")
    max_buffer_bytes: int = DEFAULT_MAX_BUFFER_BYTES
    batch_size: int = DEFAULT_BATCH_SIZE
    batch_timeout_secs: float = DEFAULT_BATCH_TIMEOUT_SECS
    poll_interval_secs: float = DEFAULT_POLL_INTERVAL_SECS
    heartbeat_interval_secs: float = DEFAULT_HEARTBEAT_INTERVAL_SECS
    initial_retry_backoff_secs: float = DEFAULT_INITIAL_RETRY_BACKOFF_SECS
    max_retry_backoff_secs: float = DEFAULT_MAX_RETRY_BACKOFF_SECS

    # Runtime credentials (loaded from credentials.json)
    agent_id: Optional[str] = None
    agent_key: Optional[str] = None
    workspace_id: Optional[str] = None
    integration_id: Optional[str] = None

    def __post_init__(self):
        if not self.credentials_path:
            self.credentials_path = str(Path(self.config_dir) / "credentials.json")
        if not self.checkpoint_path:
            self.checkpoint_path = str(Path(self.state_dir) / "checkpoint.json")
        if not self.buffer_path:
            self.buffer_path = str(Path(self.state_dir) / "buffer.db")

        # Clamp batch size
        if self.batch_size < 1:
            self.batch_size = 1
        elif self.batch_size > 100:
            self.batch_size = 100

        # Load credentials if present and not already explicitly set
        if not self.agent_id or not self.agent_key:
            self.load_credentials()

    @classmethod
    def load(
        cls,
        config_path: Optional[str] = None,
        overrides: Optional[Dict[str, Any]] = None,
    ) -> "AgentConfig":
        """
        Load configuration hierarchically:
        1. Defaults
        2. Config file (agent.json)
        3. Environment variables
        4. Explicit programmatic overrides
        5. Credentials file (credentials.json)
        """
        config_dir = os.environ.get("SENTINEL_CONFIG_DIR", DEFAULT_CONFIG_DIR)
        state_dir = os.environ.get("SENTINEL_STATE_DIR", DEFAULT_STATE_DIR)

        resolved_config_path = (
            config_path
            or os.environ.get("SENTINEL_CONFIG_PATH")
            or str(Path(config_dir) / "agent.json")
        )

        file_data: Dict[str, Any] = {}
        if Path(resolved_config_path).is_file():
            try:
                with open(resolved_config_path, "r", encoding="utf-8") as f:
                    file_data = json.load(f)
            except Exception as e:
                logger.warning(f"Could not read config file '{resolved_config_path}': {e}")

        # Build initial config args
        cfg_args: Dict[str, Any] = {
            "config_dir": config_dir,
            "state_dir": state_dir,
        }

        # Merge file data
        for key in [
            "api_url", "log_file", "credentials_path", "checkpoint_path",
            "buffer_path", "max_buffer_bytes", "batch_size", "batch_timeout_secs",
            "poll_interval_secs", "heartbeat_interval_secs",
        ]:
            if key in file_data:
                cfg_args[key] = file_data[key]

        # Environment variable overrides
        if "SENTINEL_API_URL" in os.environ:
            cfg_args["api_url"] = os.environ["SENTINEL_API_URL"]
        if "SENTINEL_LOG_FILE" in os.environ:
            cfg_args["log_file"] = os.environ["SENTINEL_LOG_FILE"]
        if "SENTINEL_BUFFER_PATH" in os.environ:
            cfg_args["buffer_path"] = os.environ["SENTINEL_BUFFER_PATH"]
        if "SENTINEL_CHECKPOINT_PATH" in os.environ:
            cfg_args["checkpoint_path"] = os.environ["SENTINEL_CHECKPOINT_PATH"]
        if "SENTINEL_CREDENTIALS_PATH" in os.environ:
            cfg_args["credentials_path"] = os.environ["SENTINEL_CREDENTIALS_PATH"]
        if "SENTINEL_MAX_BUFFER_BYTES" in os.environ:
            try:
                cfg_args["max_buffer_bytes"] = int(os.environ["SENTINEL_MAX_BUFFER_BYTES"])
            except ValueError:
                pass
        if "SENTINEL_BATCH_SIZE" in os.environ:
            try:
                cfg_args["batch_size"] = int(os.environ["SENTINEL_BATCH_SIZE"])
            except ValueError:
                pass

        # Programmatic overrides
        if overrides:
            cfg_args.update(overrides)

        cfg = cls(**cfg_args)

        # Load credentials if present
        cfg.load_credentials()

        return cfg

    def load_credentials(self) -> bool:
        """Load agent credentials from secure credentials.json."""
        cred_path = Path(self.credentials_path)
        if not cred_path.is_file():
            return False

        # Validate file permissions on POSIX
        self.verify_file_permissions(cred_path)

        try:
            with open(cred_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                self.agent_id = data.get("agent_id")
                self.agent_key = data.get("agent_key")
                self.workspace_id = data.get("workspace_id")
                self.integration_id = data.get("integration_id")
                return bool(self.agent_id and self.agent_key)
        except Exception as e:
            logger.error(f"Failed to load credentials from '{self.credentials_path}': {e}")
            return False

    def verify_file_permissions(self, path: Path) -> None:
        """
        Verify that sensitive files are not world-readable or world-writable on POSIX.
        """
        if os.name == "posix" and path.exists():
            file_stat = path.stat()
            mode = file_stat.st_mode
            if mode & (stat.S_IROTH | stat.S_IWOTH | stat.S_IXOTH):
                msg = (
                    f"Insecure permissions on credential file '{path}': "
                    f"mode {oct(mode)} is readable/writable by other users. "
                    "Expected 0600 (-rw-------)."
                )
                logger.warning(msg)
                raise InsecurePermissionsError(msg)

    def is_enrolled(self) -> bool:
        """Return True if agent has valid enrollment credentials loaded."""
        return bool(self.agent_id and self.agent_key and self.workspace_id)

    def to_safe_dict(self) -> Dict[str, Any]:
        """Convert config to dictionary with all secrets masked for logging and diagnostics."""
        data = asdict(self)
        if data.get("agent_key"):
            data["agent_key"] = mask_secret(data["agent_key"])
        return data
