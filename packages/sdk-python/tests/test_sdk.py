"""SDK unit tests using an httpx MockTransport."""

from __future__ import annotations

import json
import tempfile
from pathlib import Path

import httpx
import pytest

from authoryxos import (
    AccessDeniedError,
    AsyncClient,
    InvalidIntentError,
    PendingTimeoutError,
    SecretStr,
    TransportError,
)
from authoryxos.pause import PauseStore


API_KEY = "axos_live_" + "a" * 20


def _make_transport(handler):
    return httpx.MockTransport(handler)


@pytest.fixture()
def pause_store():
    with tempfile.TemporaryDirectory() as d:
        yield PauseStore(Path(d) / "p.db")


def _approved(req: httpx.Request) -> httpx.Response:
    body = json.loads(req.content)
    assert body["api_key"] == API_KEY
    assert body["intent"]
    return httpx.Response(200, json={
        "status": "approved",
        "token": "pending_xyz",
        "secret": "S3CR3T",
        "decision_by": "auto",
        "decided_at": "2025-01-01T00:00:00Z",
        "audit_id": "audit_x",
    })


@pytest.mark.asyncio
async def test_fetch_happy_path(pause_store):
    http = httpx.AsyncClient(transport=_make_transport(_approved))
    async with AsyncClient(API_KEY, base_url="http://x", pause_store=pause_store, http_client=http) as c:
        s = await c.fetch(key="TEST_KEY", intent="hello")
        assert isinstance(s, SecretStr)
        assert s.reveal() == "S3CR3T"
        assert str(s) == "***"
        assert repr(s) == "SecretStr(***)"


@pytest.mark.asyncio
async def test_with_secret_never_returns_secret(pause_store):
    http = httpx.AsyncClient(transport=_make_transport(_approved))
    seen = {}

    def use(secret: str) -> int:
        seen["s"] = secret
        return len(secret)

    async with AsyncClient(API_KEY, base_url="http://x", pause_store=pause_store, http_client=http) as c:
        n = await c.with_secret(key="TEST_KEY", intent="use", exec=use)
        assert n == 6
        assert seen["s"] == "S3CR3T"


@pytest.mark.asyncio
async def test_denied(pause_store):
    def denied(req):
        return httpx.Response(200, json={
            "status": "denied", "token": "pending_x", "reason": "no",
            "decided_at": "2025-01-01T00:00:00Z", "audit_id": "audit_y",
        })

    http = httpx.AsyncClient(transport=_make_transport(denied))
    async with AsyncClient(API_KEY, base_url="http://x", pause_store=pause_store, http_client=http) as c:
        with pytest.raises(AccessDeniedError):
            await c.fetch(key="TEST_KEY", intent="x")


@pytest.mark.asyncio
async def test_transport_error_on_replay(pause_store):
    def replay(req):
        return httpx.Response(400, json={
            "error": {"code": "replayed_nonce", "message": "nope", "retryable": False}
        })

    http = httpx.AsyncClient(transport=_make_transport(replay))
    async with AsyncClient(API_KEY, base_url="http://x", pause_store=pause_store, http_client=http) as c:
        with pytest.raises(TransportError) as exc:
            await c.fetch(key="TEST_KEY", intent="x")
        assert exc.value.code == "replayed_nonce"


@pytest.mark.asyncio
async def test_pending_then_approved(pause_store):
    calls = {"n": 0}

    def handler(req: httpx.Request) -> httpx.Response:
        if req.method == "POST":
            return httpx.Response(200, json={
                "status": "pending",
                "token": "pending_abc",
                "poll_url": "/v1/os/pending/pending_abc",
                "poll_interval_seconds": 0,
                "expires_at": "2099-01-01T00:00:00Z",
            })
        calls["n"] += 1
        if calls["n"] < 2:
            return httpx.Response(200, json={
                "status": "pending", "token": "pending_abc",
                "poll_url": "/v1/os/pending/pending_abc",
                "poll_interval_seconds": 0,
                "expires_at": "2099-01-01T00:00:00Z",
            })
        return httpx.Response(200, json={
            "status": "approved", "token": "pending_abc",
            "secret": "OK", "decision_by": "owner",
            "decided_at": "2025-01-01T00:00:00Z", "audit_id": "a",
        })

    http = httpx.AsyncClient(transport=_make_transport(handler))
    async with AsyncClient(API_KEY, base_url="http://x", pause_store=pause_store, http_client=http) as c:
        s = await c.fetch(key="TEST_KEY", intent="x")
        assert s.reveal() == "OK"
    # pause row should be deleted after resolution
    assert pause_store.all() == []


@pytest.mark.asyncio
async def test_pending_timeout(pause_store):
    def handler(req):
        if req.method == "POST":
            return httpx.Response(200, json={
                "status": "pending", "token": "pending_t",
                "poll_url": "/v1/os/pending/pending_t",
                "poll_interval_seconds": 0,
                "expires_at": "2099-01-01T00:00:00Z",
            })
        return httpx.Response(200, json={
            "status": "pending", "token": "pending_t",
            "poll_url": "/v1/os/pending/pending_t",
            "poll_interval_seconds": 0,
            "expires_at": "2099-01-01T00:00:00Z",
        })

    http = httpx.AsyncClient(transport=_make_transport(handler))
    async with AsyncClient(API_KEY, base_url="http://x", pause_store=pause_store,
                          http_client=http, timeout_seconds=0) as c:
        with pytest.raises(PendingTimeoutError):
            await c.fetch(key="TEST_KEY", intent="x")


def test_invalid_api_key_format():
    with pytest.raises(InvalidIntentError):
        from authoryxos import intent as i
        i.build(api_key="bad", key_name="K", intent="x",
                agent_id=None, session_id=None, policy=None)


def test_pause_store_never_contains_secret(pause_store):
    from authoryxos.pause import PendingRow
    pause_store.save(PendingRow(
        token="pending_q", base_url="http://x", poll_url="/v1/os/pending/pending_q",
        poll_interval=5, expires_at="2099-01-01T00:00:00Z",
        key_name="TEST_KEY", agent_id="a", session_id="s",
        created_at="2025-01-01T00:00:00Z",
    ))
    raw = pause_store.path.read_bytes()
    assert b"S3CR3T" not in raw
    # Schema column names sanity check
    assert b"pending" in raw
