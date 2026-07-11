"""Protocol-level tests for the mock backend."""

from __future__ import annotations

import os
import secrets as _s
import tempfile
import uuid
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("MOCK_DB_PATH", tmp.name)
    monkeypatch.setenv("MOCK_AUTO_APPROVE", "true")
    monkeypatch.setenv("MOCK_OWNER_TOKEN", "owner-tok")
    monkeypatch.setenv("TEST_KEY", "hello-world")
    # Re-import so module-level db.init_db() runs against the temp DB.
    import importlib, authoryxos_mock.main as m
    importlib.reload(m)
    yield TestClient(m.app)
    os.unlink(tmp.name)


def _payload(**overrides):
    base = {
        "api_key": "axos_live_" + "a" * 20,
        "key_name": "TEST_KEY",
        "intent": "running unit tests",
        "agent_id": "tester",
        "session_id": "s1",
        "nonce": _s.token_hex(12),
        "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }
    base.update(overrides)
    return base


def test_happy_path_auto_approve(client):
    r = client.post("/v1/os/secrets/TEST_KEY", json=_payload())
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "approved"
    assert body["secret"] == "hello-world"
    assert body["audit_id"].startswith("audit_")


def test_replay_rejected(client):
    p = _payload()
    r1 = client.post("/v1/os/secrets/TEST_KEY", json=p)
    assert r1.status_code == 200
    r2 = client.post("/v1/os/secrets/TEST_KEY", json=p)
    assert r2.status_code == 400
    assert r2.json()["error"]["code"] == "replayed_nonce"


def test_clock_skew_rejected(client):
    p = _payload(timestamp="2000-01-01T00:00:00Z")
    r = client.post("/v1/os/secrets/TEST_KEY", json=p)
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "clock_skew"


def test_invalid_api_key(client):
    p = _payload(api_key="not-a-key")
    r = client.post("/v1/os/secrets/TEST_KEY", json=p)
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "invalid_api_key"


def test_unknown_key(client):
    p = _payload(key_name="NOT_CONFIGURED")
    r = client.post("/v1/os/secrets/NOT_CONFIGURED", json=p)
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "unknown_key"


def test_pending_then_approve(client, monkeypatch):
    monkeypatch.setenv("MOCK_AUTO_APPROVE", "false")
    r = client.post("/v1/os/secrets/TEST_KEY", json=_payload())
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "pending"
    token = body["token"]

    poll = client.get(f"/v1/os/pending/{token}").json()
    assert poll["status"] == "pending"

    dec = client.post(
        f"/v1/os/decisions/{token}",
        json={"decision": "approve"},
        headers={"Authorization": "Bearer owner-tok"},
    )
    assert dec.status_code == 200
    assert dec.json()["status"] == "approved"

    poll2 = client.get(f"/v1/os/pending/{token}").json()
    assert poll2["status"] == "approved"
    assert poll2["secret"] == "hello-world"


def test_pending_then_deny(client, monkeypatch):
    monkeypatch.setenv("MOCK_AUTO_APPROVE", "false")
    r = client.post("/v1/os/secrets/TEST_KEY", json=_payload())
    token = r.json()["token"]
    dec = client.post(
        f"/v1/os/decisions/{token}",
        json={"decision": "deny", "reason": "nope"},
        headers={"Authorization": "Bearer owner-tok"},
    )
    assert dec.json()["status"] == "denied"
    assert client.get(f"/v1/os/pending/{token}").json()["status"] == "denied"


def test_owner_token_required(client, monkeypatch):
    monkeypatch.setenv("MOCK_AUTO_APPROVE", "false")
    r = client.post("/v1/os/secrets/TEST_KEY", json=_payload())
    token = r.json()["token"]
    dec = client.post(f"/v1/os/decisions/{token}", json={"decision": "approve"})
    assert dec.status_code == 401
