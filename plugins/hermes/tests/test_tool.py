from __future__ import annotations

import json
import tempfile
from pathlib import Path

import httpx
import pytest

from authoryxos import AccessDeniedError, AsyncClient
from authoryxos.pause import PauseStore

from authoryxos_hermes import (
    DESCRIPTION,
    NAME,
    SCHEMA,
    attach,
    handler,
)
from authoryxos_hermes.runtime import _reset

API_KEY = "axos_live_" + "a" * 20


@pytest.fixture()
def pause_store():
    with tempfile.TemporaryDirectory() as d:
        yield PauseStore(Path(d) / "p.db")


def _client(handler_fn, pause_store) -> AsyncClient:
    return AsyncClient(
        API_KEY,
        base_url="http://x",
        pause_store=pause_store,
        http_client=httpx.AsyncClient(transport=httpx.MockTransport(handler_fn)),
    )


def _approved(_req):
    return httpx.Response(200, json={
        "status": "approved", "token": "pending_x", "secret": "PLAINTEXT",
        "decision_by": "auto", "decided_at": "x", "audit_id": "a",
    })


def _denied(_req):
    return httpx.Response(200, json={
        "status": "denied", "token": "pending_x", "reason": "spam",
        "decided_at": "x", "audit_id": "y",
    })


def _replay(_req):
    return httpx.Response(400, json={
        "error": {"code": "replayed_nonce", "message": "nope", "retryable": False}
    })


def test_schema_shape() -> None:
    assert NAME == "authoryxos_fetch_secret"
    assert "key" in SCHEMA["properties"]
    assert "intent" in SCHEMA["properties"]
    assert SCHEMA["required"] == ["key", "intent"]
    assert "intent" in DESCRIPTION.lower()


@pytest.mark.asyncio
async def test_handler_rejects_empty_input(pause_store) -> None:
    _reset()
    attach(_client(_approved, pause_store))
    r = await handler({"key": "", "intent": ""})
    assert r == {
        "ok": False,
        "error": {"code": "invalid_intent", "message": "Both 'key' and 'intent' are required."},
    }


@pytest.mark.asyncio
async def test_handler_returns_revealed_value_on_approval(pause_store) -> None:
    _reset()
    attach(_client(_approved, pause_store))
    r = await handler({"key": "TEST_KEY", "intent": "approve in test"})
    assert r["ok"] is True
    assert r["value"] == "PLAINTEXT"


@pytest.mark.asyncio
async def test_handler_maps_denied_to_structured_error(pause_store) -> None:
    _reset()
    attach(_client(_denied, pause_store))
    r = await handler({"key": "TEST_KEY", "intent": "x"})
    assert r["ok"] is False
    assert r["error"]["code"] == "denied"
    assert r["error"]["message"] == "spam"


@pytest.mark.asyncio
async def test_handler_maps_transport_error_to_structured_error(pause_store) -> None:
    _reset()
    attach(_client(_replay, pause_store))
    r = await handler({"key": "TEST_KEY", "intent": "x"})
    assert r["ok"] is False
    assert r["error"]["code"] == "TransportError"


def test_access_denied_error_carries_fields() -> None:
    e = AccessDeniedError("nope", reason="spam", token="t")
    assert e.reason == "spam"
    assert e.token == "t"


def test_register_returns_false_when_hermes_not_installed() -> None:
    # Hermes isn't installed in CI / dev — register() should bail gracefully.
    import sys

    # Make sure no stale fake module is around from another test.
    for mod in [m for m in sys.modules if m.startswith("hermes")]:
        del sys.modules[mod]
    import authoryxos_hermes as p

    # Clear cached "already registered" flag so we exercise the import path.
    p._registered = False
    assert p.register() is False


def test_register_calls_hermes_registry_when_present(monkeypatch) -> None:
    """Inject a fake `hermes.tools.registry` to verify the registration call shape."""
    import sys
    import types

    captured: dict[str, object] = {}

    fake_registry = types.SimpleNamespace(
        register=lambda **kwargs: captured.update(kwargs),
    )
    fake_tools = types.ModuleType("hermes.tools")
    fake_tools.registry = fake_registry  # type: ignore[attr-defined]
    fake_hermes = types.ModuleType("hermes")
    fake_hermes.tools = fake_tools  # type: ignore[attr-defined]

    monkeypatch.setitem(sys.modules, "hermes", fake_hermes)
    monkeypatch.setitem(sys.modules, "hermes.tools", fake_tools)
    monkeypatch.setitem(sys.modules, "hermes.tools.registry", fake_registry)

    import authoryxos_hermes as p
    p._registered = False
    assert p.register() is True

    assert captured["name"] == "authoryxos_fetch_secret"
    assert captured["toolset"] == "authoryxos"
    assert captured["is_async"] is True
    assert captured["schema"]["required"] == ["key", "intent"]
    assert "AUTHORYXOS_API_KEY" in captured["requires_env"]  # type: ignore[operator]
    assert callable(captured["handler"])
    assert callable(captured["check_fn"])
