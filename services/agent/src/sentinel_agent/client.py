"""
NomaanOS Sentinel — Authenticated HTTP Client with Retry, Jitter, and Revocation Detection.
"""

import json
import logging
import random
import urllib.error
import urllib.request
import uuid
from typing import List, Dict, Any, Optional

logger = logging.getLogger("sentinel_agent.client")


class AgentRevokedError(Exception):
    """Raised when server indicates agent credentials have been revoked or invalidated (HTTP 401/403)."""
    pass


class SchemaRejectionError(Exception):
    """Raised when server rejects a batch due to canonical schema validation failures (HTTP 422)."""
    pass


class DeliveryNetworkError(Exception):
    """Raised when transient network, DNS, or server 5xx errors occur."""
    pass


def calculate_backoff(
    attempt: int,
    base: float = 1.0,
    factor: float = 2.0,
    max_backoff: float = 60.0,
    jitter_pct: float = 0.2,
) -> float:
    """
    Compute exponential backoff with full symmetric jitter to prevent thundering herds.
    """
    exponential = min(max_backoff, base * (factor ** attempt))
    jitter_range = exponential * jitter_pct
    jitter = random.uniform(-jitter_range, jitter_range)
    return max(0.1, exponential + jitter)


class SentinelClient:
    """
    Authenticated HTTP client communicating with NomaanOS Sentinel API.
    Zero external dependencies (uses standard library urllib).
    """

    def __init__(
        self,
        api_url: str,
        agent_id: str,
        agent_key: str,
        timeout_secs: float = 10.0,
    ):
        self.api_url = api_url.rstrip("/")
        self.agent_id = agent_id
        self.agent_key = agent_key
        self.timeout_secs = timeout_secs
        self.is_revoked = False

    def send_heartbeat(self, diagnostics: Optional[Dict[str, Any]] = None) -> bool:
        """
        Send periodic heartbeat proving agent liveness, credential validity, and runtime health telemetry.
        """
        if self.is_revoked:
            raise AgentRevokedError("Agent credentials have been permanently revoked.")

        endpoint = f"{self.api_url}/api/v1/integrations/agent/heartbeat"
        body_dict = {}
        if diagnostics is not None:
            body_dict["diagnostics"] = diagnostics
        req_bytes = json.dumps(body_dict).encode("utf-8")

        req = urllib.request.Request(
            endpoint,
            data=req_bytes,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self.agent_key}",
                "X-Agent-Id": self.agent_id,
                "User-Agent": "NomaanOS-Sentinel-Agent/0.1.0",
            },
            method="POST",
        )

        try:
            with urllib.request.urlopen(req, timeout=self.timeout_secs) as resp:
                return resp.getcode() == 200
        except urllib.error.HTTPError as e:
            if e.code in (401, 403):
                self.is_revoked = True
                logger.critical(
                    f"Heartbeat rejected: agent credentials have been revoked (HTTP {e.code}). "
                    "Ceasing delivery attempts."
                )
                raise AgentRevokedError("Agent credentials have been revoked by the workspace administrator.")
            raise DeliveryNetworkError(f"Heartbeat failed with HTTP {e.code}")
        except urllib.error.URLError as e:
            raise DeliveryNetworkError(f"Heartbeat connection failed: {e.reason}")
        except Exception as e:
            raise DeliveryNetworkError(f"Heartbeat unexpected error: {e}")

    def deliver_batch(
        self,
        events: List[Dict[str, Any]],
        batch_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Deliver a batch of normalized security events to the API.
        """
        if self.is_revoked:
            raise AgentRevokedError("Agent credentials have been permanently revoked.")

        if not events:
            return {"status": "ok", "acceptedCount": 0}

        endpoint = f"{self.api_url}/api/v1/integrations/agent/events"
        assigned_batch_id = batch_id or str(uuid.uuid4())

        payload = {
            "batchId": assigned_batch_id,
            "events": events,
        }

        req_bytes = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            endpoint,
            data=req_bytes,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self.agent_key}",
                "X-Agent-Id": self.agent_id,
                "User-Agent": "NomaanOS-Sentinel-Agent/0.1.0",
            },
            method="POST",
        )

        try:
            with urllib.request.urlopen(req, timeout=self.timeout_secs) as resp:
                status_code = resp.getcode()
                raw_body = resp.read().decode("utf-8")
                if status_code == 200:
                    return json.loads(raw_body)
                raise DeliveryNetworkError(f"Unexpected status code {status_code}: {raw_body}")
        except urllib.error.HTTPError as e:
            err_body = e.read().decode("utf-8", errors="replace")
            if e.code in (401, 403):
                self.is_revoked = True
                logger.critical(
                    f"Batch delivery rejected: agent credentials revoked (HTTP {e.code}). "
                    "Ceasing further delivery attempts."
                )
                raise AgentRevokedError("Agent credentials have been revoked.")
            elif e.code == 422:
                logger.error(f"Batch rejected due to canonical schema invalidity (HTTP 422): {err_body}")
                raise SchemaRejectionError(f"Schema validation error: {err_body}")
            else:
                raise DeliveryNetworkError(f"Server error HTTP {e.code}: {err_body}")
        except urllib.error.URLError as e:
            raise DeliveryNetworkError(f"Network error connecting to {self.api_url}: {e.reason}")
        except Exception as e:
            raise DeliveryNetworkError(f"Unexpected delivery error: {e}")

