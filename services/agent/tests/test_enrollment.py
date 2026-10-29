import io
import json
import urllib.error
import pytest

from sentinel_agent.enrollment import enroll_agent, EnrollmentError


def test_enroll_agent_rejects_empty_token(tmp_path):
    cred_file = tmp_path / "credentials.json"
    with pytest.raises(EnrollmentError) as exc_info:
        enroll_agent(
            token="",
            api_url="http://localhost:4000",
            credentials_path=str(cred_file),
        )
    assert "token cannot be empty" in str(exc_info.value)


def test_enroll_agent_success(tmp_path, monkeypatch):
    cred_file = tmp_path / "credentials.json"

    class MockEnrollResponse:
        def getcode(self):
            return 200

        def read(self):
            return json.dumps({
                "status": "ok",
                "agentId": "new-agent-uuid",
                "agentKey": "secret-agent-key-value",
                "integrationId": "new-integration-uuid",
                "workspaceId": "new-workspace-uuid",
            }).encode("utf-8")

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

    def mock_urlopen(req, timeout):
        assert "/api/v1/integrations/enroll" in req.get_full_url()
        data = json.loads(req.data.decode("utf-8"))
        assert data["enrollmentToken"] == "sentinel_enroll_valid123"
        assert "agentMetadata" in data
        assert "hostname" in data["agentMetadata"]
        return MockEnrollResponse()

    monkeypatch.setattr("urllib.request.urlopen", mock_urlopen)

    result = enroll_agent(
        token="sentinel_enroll_valid123",
        api_url="http://localhost:4000",
        credentials_path=str(cred_file),
    )

    assert result["status"] == "ok"
    assert result["agent_id"] == "new-agent-uuid"
    assert result["workspace_id"] == "new-workspace-uuid"
    assert cred_file.is_file()

    # Verify persisted credentials
    with open(cred_file, "r", encoding="utf-8") as f:
        saved = json.load(f)
        assert saved["agent_id"] == "new-agent-uuid"
        assert saved["agent_key"] == "secret-agent-key-value"
        assert saved["workspace_id"] == "new-workspace-uuid"


def test_enroll_agent_handles_server_rejection_401(tmp_path, monkeypatch):
    cred_file = tmp_path / "credentials.json"

    def mock_urlopen(req, timeout):
        fp = io.BytesIO(b'{"error": "Unauthorized", "message": "Invalid, expired, or revoked enrollment token."}')
        raise urllib.error.HTTPError(
            url=req.get_full_url(),
            code=401,
            msg="Unauthorized",
            hdrs={},
            fp=fp,
        )

    monkeypatch.setattr("urllib.request.urlopen", mock_urlopen)

    with pytest.raises(EnrollmentError) as exc_info:
        enroll_agent(
            token="sentinel_enroll_expired",
            api_url="http://localhost:4000",
            credentials_path=str(cred_file),
        )

    assert "Invalid, expired, or revoked" in str(exc_info.value)
    assert not cred_file.exists()

