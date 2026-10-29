"""
NomaanOS Sentinel — Agent Enrollment Handshake.
"""

import json
import logging
import os
import platform
import socket
import stat
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, Dict, Any

logger = logging.getLogger("sentinel_agent.enrollment")


class EnrollmentError(Exception):
    """Raised when agent enrollment fails."""
    pass


def enroll_agent(
    token: str,
    api_url: str,
    credentials_path: str,
    agent_metadata: Optional[Dict[str, Any]] = None,
    timeout_secs: float = 10.0,
) -> Dict[str, Any]:
    """
    Perform the secure single-use enrollment token exchange.
    Authenticates with the Sentinel server, exchanges the enrollment token
    for long-term agent credentials, and persists credentials with strict 0600 permissions.
    """
    if not token or not token.strip():
        raise EnrollmentError("Enrollment token cannot be empty.")

    clean_token = token.strip()
    clean_api_url = api_url.rstrip("/")
    enroll_endpoint = f"{clean_api_url}/api/v1/integrations/enroll"

    metadata = {
        "hostname": socket.gethostname(),
        "platform": platform.platform(),
        "python_version": platform.python_version(),
        "agent_version": "0.1.0",
    }
    if agent_metadata:
        metadata.update(agent_metadata)

    payload = {
        "enrollmentToken": clean_token,
        "agentMetadata": metadata,
    }

    req_data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        enroll_endpoint,
        data=req_data,
        headers={
            "Content-Type": "application/json",
            "User-Agent": "NomaanOS-Sentinel-Agent/0.1.0",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=timeout_secs) as resp:
            status_code = resp.getcode()
            raw_body = resp.read().decode("utf-8")
            if status_code != 200:
                raise EnrollmentError(f"Server returned HTTP {status_code}: {raw_body}")
            response_json = json.loads(raw_body)
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="replace")
        try:
            parsed = json.loads(err_body)
            msg = parsed.get("message", err_body)
        except Exception:
            msg = err_body
        raise EnrollmentError(f"Enrollment rejected (HTTP {e.code}): {msg}")
    except urllib.error.URLError as e:
        raise EnrollmentError(f"Failed to connect to Sentinel server at '{clean_api_url}': {e.reason}")
    except Exception as e:
        raise EnrollmentError(f"Enrollment failed unexpectedly: {e}")

    agent_id = response_json.get("agentId")
    agent_key = response_json.get("agentKey")
    integration_id = response_json.get("integrationId")
    workspace_id = response_json.get("workspaceId")

    if not agent_id or not agent_key or not workspace_id:
        raise EnrollmentError("Server response is missing required agent credentials.")

    # Securely persist credentials to disk
    cred_file = Path(credentials_path)
    cred_file.parent.mkdir(parents=True, exist_ok=True)

    cred_data = {
        "agent_id": agent_id,
        "agent_key": agent_key,
        "integration_id": integration_id,
        "workspace_id": workspace_id,
        "enrolled_at": datetime.now(timezone.utc).isoformat(),
        "api_url": clean_api_url,
    }

    # Write file securely
    flags = os.O_WRONLY | os.O_CREAT | os.O_TRUNC
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW

    # On POSIX set mode 0600 on creation
    mode = stat.S_IRUSR | stat.S_IWUSR  # 0600
    fd = os.open(str(cred_file), flags, mode)
    try:
        with open(fd, "w", encoding="utf-8", closefd=True) as f:
            json.dump(cred_data, f, indent=2)
    except Exception:
        pass

    # Ensure permissions are strictly 0600 on POSIX
    if os.name == "posix":
        try:
            os.chmod(str(cred_file), stat.S_IRUSR | stat.S_IWUSR)
        except Exception as e:
            logger.warning(f"Could not set 0600 permissions on '{cred_file}': {e}")

    logger.info(f"Agent successfully enrolled (Agent ID: {agent_id}, Workspace ID: {workspace_id})")

    return {
        "status": "ok",
        "agent_id": agent_id,
        "integration_id": integration_id,
        "workspace_id": workspace_id,
        "credentials_path": str(cred_file),
    }

