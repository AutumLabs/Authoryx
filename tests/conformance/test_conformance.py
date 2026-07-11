"""Authoryx-protocol conformance suite.

A backend that passes every case here may claim Authoryx-protocol
compatibility (see docs/protocol-spec.md §9). Runs over HTTP; see conftest.py
for configuration.
"""

from __future__ import annotations

import httpx

from conftest import CONFORMANCE_KEY, CONFORMANCE_VALUE, intent_payload, now_iso


def _auth(key: str) -> dict:
    return {"Authorization": f"Bearer {key}"}


def _submit(base_url, admin_key, **over):
    return httpx.post(
        f"{base_url}/v1/os/secrets/{over.get('key_name', CONFORMANCE_KEY)}",
        headers=_auth(admin_key),
        json=intent_payload(**over),
        timeout=15,
    )


def test_invalid_api_key(base_url):
    r = httpx.post(
        f"{base_url}/v1/os/secrets/{CONFORMANCE_KEY}",
        headers=_auth("not-a-real-key"),
        json=intent_payload(),
        timeout=10,
    )
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "invalid_api_key"


def test_unknown_key(base_url, admin_key):
    r = _submit(base_url, admin_key, key_name="NO_SUCH_KEY_XYZ")
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "unknown_key"


def test_clock_skew(base_url, admin_key):
    r = _submit(base_url, admin_key, timestamp=now_iso(-3600))
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "clock_skew"


def test_replayed_nonce(base_url, admin_key):
    payload = intent_payload()
    r1 = httpx.post(f"{base_url}/v1/os/secrets/{CONFORMANCE_KEY}",
                    headers=_auth(admin_key), json=payload, timeout=10)
    assert r1.status_code == 200
    r2 = httpx.post(f"{base_url}/v1/os/secrets/{CONFORMANCE_KEY}",
                    headers=_auth(admin_key), json=payload, timeout=10)
    assert r2.status_code == 400
    assert r2.json()["error"]["code"] == "replayed_nonce"


def test_pending_then_approve(base_url, admin_key):
    r = _submit(base_url, admin_key, policy="require_approval")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "pending"
    token = body["token"]
    assert token.startswith("pending_")

    # Poll → still pending.
    r = httpx.get(f"{base_url}{body['poll_url']}", timeout=10)
    assert r.json()["status"] == "pending"

    # Owner approves.
    r = httpx.post(f"{base_url}/v1/os/decisions/{token}",
                   headers=_auth(admin_key), json={"decision": "approve"}, timeout=10)
    assert r.status_code == 200
    assert r.json()["secret"] == CONFORMANCE_VALUE

    # Poll → approved with secret.
    r = httpx.get(f"{base_url}/v1/os/pending/{token}", timeout=10)
    assert r.json()["status"] == "approved"
    assert r.json()["secret"] == CONFORMANCE_VALUE


def test_pending_then_deny(base_url, admin_key):
    r = _submit(base_url, admin_key, policy="require_approval")
    token = r.json()["token"]
    r = httpx.post(f"{base_url}/v1/os/decisions/{token}",
                   headers=_auth(admin_key), json={"decision": "deny", "reason": "no"}, timeout=10)
    assert r.json()["status"] == "denied"
    r = httpx.get(f"{base_url}/v1/os/pending/{token}", timeout=10)
    assert r.json()["status"] == "denied"
    assert r.json()["reason"] == "no"


def test_audit_shape(base_url, admin_key):
    r = httpx.get(f"{base_url}/v1/os/audit", headers=_auth(admin_key), timeout=10)
    assert r.status_code == 200
    records = r.json()["records"]
    assert records, "expected at least one audit record"
    required = {"audit_id", "agent_id", "session_id", "key_name", "intent",
                "decision", "requested_at", "nonce"}
    assert required.issubset(records[0].keys())
