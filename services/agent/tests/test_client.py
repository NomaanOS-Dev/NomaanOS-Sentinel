import io
import json
import urllib.error
import pytest

from sentinel_agent.client import (
    SentinelClient,
    AgentRevokedError,
    DeliveryNetworkError,
    SchemaRejectionError,
    calculate_backoff,
)


def test_calculate_backoff():
    # Attempt 0: base 1.0 ± 20%
    b0 = calculate_backoff(0, base=1.0, factor=2.0, max_backoff=60.0, jitter_pct=0.2)
    assert 0.8 <= b0 <= 1.2

    # Attempt 1: 2.0 ± 20%
    b1 = calculate_backoff(1, base=1.0, factor=2.0, max_backoff=60.0, jitter_pct=0.2)
    assert 1.6 <= b1 <= 2.4

    # Max clamp
    b_max = calculate_backoff(10, base=1.0, factor=2.0, max_backoff=60.0, jitter_pct=0.1)
    assert 54.0 <= b_max <= 66.0


def test_client_deliver_batch_success(monkeypatch):
    client = SentinelClient(
        api_url="http://mock-api:4000",
        agent_id="test-agent-id",
        agent_key="test-agent-key",
    )

    class MockResponse:
        def __init__(self):
            self._body = json.dumps({"status": "ok", "acceptedCount": 1}).encode("utf-8")

        def getcode(self):
            return 200

        def read(self):
            return self._body

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

    def mock_urlopen(req, timeout):
        # Verify headers
        assert req.get_header("Authorization") == "Bearer test-agent-key"
        assert req.get_header("X-agent-id") == "test-agent-id"
        return MockResponse()

    monkeypatch.setattr("urllib.request.urlopen", mock_urlopen)

    res = client.deliver_batch([{"id": "ev-1", "message": "msg"}])
    assert res["status"] == "ok"
    assert res["acceptedCount"] == 1


def test_client_handles_revocation_401(monkeypatch):
    client = SentinelClient(
        api_url="http://mock-api:4000",
        agent_id="test-agent-id",
        agent_key="revoked-key",
    )

    def mock_urlopen(req, timeout):
        fp = io.BytesIO(b'{"error": "Unauthorized", "message": "Credentials revoked"}')
        raise urllib.error.HTTPError(
            url=req.get_full_url(),
            code=401,
            msg="Unauthorized",
            hdrs={},
            fp=fp,
        )

    monkeypatch.setattr("urllib.request.urlopen", mock_urlopen)

    with pytest.raises(AgentRevokedError):
        client.deliver_batch([{"id": "ev-1"}])

    assert client.is_revoked is True

    # Subsequent calls immediately raise AgentRevokedError without making network request
    with pytest.raises(AgentRevokedError):
        client.send_heartbeat()


def test_client_handles_transient_network_error(monkeypatch):
    client = SentinelClient(
        api_url="http://mock-api:4000",
        agent_id="test-agent-id",
        agent_key="test-key",
    )

    def mock_urlopen(req, timeout):
        raise urllib.error.URLError("Connection refused")

    monkeypatch.setattr("urllib.request.urlopen", mock_urlopen)

    with pytest.raises(DeliveryNetworkError):
        client.deliver_batch([{"id": "ev-1"}])

    # Client is NOT marked revoked on transient network errors
    assert client.is_revoked is False

