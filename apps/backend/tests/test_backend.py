"""End-to-end backend tests against the FastAPI app (SQLite)."""

from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone


def _nonce() -> str:
    return secrets.token_hex(12)  # 24 hex chars


def _now_iso(offset_seconds: int = 0) -> str:
    dt = datetime.now(timezone.utc) + timedelta(seconds=offset_seconds)
    return dt.isoformat().replace("+00:00", "Z")


def _intent(key: str, agent="test-agent", policy=None, **over):
    body = {
        "key_name": key,
        "intent": f"need {key} for a unit test",
        "agent_id": agent,
        "session_id": "sess-1",
        "nonce": _nonce(),
        "timestamp": _now_iso(),
    }
    if policy:
        body["policy_hint"] = policy
    body.update(over)
    return body


def _auth(key: str) -> dict:
    return {"Authorization": f"Bearer {key}"}


def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_admin_scope_enforced(client, admin_key):
    # Issue an agent-scoped key, then try an admin call with it.
    r = client.post("/v1/admin/api-keys", headers=_auth(admin_key),
                    json={"label": "agent1", "scope": "agent"})
    assert r.status_code == 201
    agent_key = r.json()["api_key"]

    r = client.post("/v1/admin/keys", headers=_auth(agent_key),
                    json={"key_name": "NOPE", "value": "x"})
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "forbidden"


def test_store_and_auto_approve(client, admin_key):
    # Store a secret and register an agent that does not require approval.
    client.post("/v1/admin/keys", headers=_auth(admin_key),
                json={"key_name": "AUTO_KEY", "value": "auto-secret"})
    client.post("/v1/admin/agents", headers=_auth(admin_key),
                json={"name": "auto", "external_id": "auto-agent",
                      "require_approval": False, "default_policy": "approve_once"})

    r = client.post("/v1/os/secrets/AUTO_KEY", headers=_auth(admin_key),
                    json=_intent("AUTO_KEY", agent="auto-agent", policy="approve_once"))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "approved"
    assert body["secret"] == "auto-secret"
    assert body["effective_policy"] == "approve_once"


def test_require_approval_then_owner_approves(client, admin_key):
    client.post("/v1/admin/keys", headers=_auth(admin_key),
                json={"key_name": "HUMAN_KEY", "value": "human-secret"})

    r = client.post("/v1/os/secrets/HUMAN_KEY", headers=_auth(admin_key),
                    json=_intent("HUMAN_KEY", policy="require_approval"))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "pending"
    token = body["token"]

    # Poll: still pending.
    r = client.get(f"/v1/os/pending/{token}")
    assert r.json()["status"] == "pending"

    # Owner approves via the admin-scoped decisions endpoint.
    r = client.post(f"/v1/os/decisions/{token}", headers=_auth(admin_key),
                    json={"decision": "approve"})
    assert r.status_code == 200, r.text
    assert r.json()["secret"] == "human-secret"

    # Poll now returns approved + secret.
    r = client.get(f"/v1/os/pending/{token}")
    assert r.json()["status"] == "approved"
    assert r.json()["secret"] == "human-secret"


def test_deny_path(client, admin_key):
    client.post("/v1/admin/keys", headers=_auth(admin_key),
                json={"key_name": "DENY_KEY", "value": "nope"})
    r = client.post("/v1/os/secrets/DENY_KEY", headers=_auth(admin_key),
                    json=_intent("DENY_KEY", policy="require_approval"))
    token = r.json()["token"]
    r = client.post(f"/v1/os/decisions/{token}", headers=_auth(admin_key),
                    json={"decision": "deny", "reason": "not allowed"})
    assert r.json()["status"] == "denied"
    r = client.get(f"/v1/os/pending/{token}")
    assert r.json()["status"] == "denied"
    assert r.json()["reason"] == "not allowed"


def test_replay_nonce(client, admin_key):
    client.post("/v1/admin/keys", headers=_auth(admin_key),
                json={"key_name": "REPLAY_KEY", "value": "s"})
    payload = _intent("REPLAY_KEY", policy="require_approval")
    r1 = client.post("/v1/os/secrets/REPLAY_KEY", headers=_auth(admin_key), json=payload)
    assert r1.status_code == 200
    r2 = client.post("/v1/os/secrets/REPLAY_KEY", headers=_auth(admin_key), json=payload)
    assert r2.status_code == 400
    assert r2.json()["error"]["code"] == "replayed_nonce"


def test_clock_skew(client, admin_key):
    client.post("/v1/admin/keys", headers=_auth(admin_key),
                json={"key_name": "SKEW_KEY", "value": "s"})
    payload = _intent("SKEW_KEY", policy="require_approval")
    payload["timestamp"] = _now_iso(offset_seconds=-3600)
    r = client.post("/v1/os/secrets/SKEW_KEY", headers=_auth(admin_key), json=payload)
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "clock_skew"


def test_unknown_key(client, admin_key):
    r = client.post("/v1/os/secrets/DOES_NOT_EXIST", headers=_auth(admin_key),
                    json=_intent("DOES_NOT_EXIST", policy="require_approval"))
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "unknown_key"


def test_invalid_api_key(client):
    r = client.post("/v1/os/secrets/TEST_KEY", headers=_auth("bad"),
                    json=_intent("TEST_KEY"))
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "invalid_api_key"


def test_audit_lists(client, admin_key):
    r = client.get("/v1/os/audit", headers=_auth(admin_key))
    assert r.status_code == 200
    assert "records" in r.json()
    assert len(r.json()["records"]) >= 1


def test_secret_value_never_listed(client, admin_key):
    client.post("/v1/admin/keys", headers=_auth(admin_key),
                json={"key_name": "HIDDEN_KEY", "value": "super-secret-value"})
    r = client.get("/v1/admin/keys", headers=_auth(admin_key))
    assert r.status_code == 200
    assert "super-secret-value" not in r.text
