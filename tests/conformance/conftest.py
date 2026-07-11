"""Conformance-suite fixtures.

The suite runs over HTTP against ANY Authoryx-protocol backend (the bundled
``apps/backend`` or a hosted one). Point it with:

    AUTHORYXOS_BASE_URL    default http://localhost:8787
    AUTHORYXOS_ADMIN_KEY   an admin-scoped API key (required)

If the admin key is absent, the whole suite is skipped.
"""

from __future__ import annotations

import os
import secrets
from datetime import datetime, timedelta, timezone

import httpx
import pytest

BASE_URL = os.environ.get("AUTHORYXOS_BASE_URL", "http://localhost:8787").rstrip("/")
ADMIN_KEY = os.environ.get("AUTHORYXOS_ADMIN_KEY", "")

CONFORMANCE_KEY = "CONFORMANCE_KEY"
CONFORMANCE_VALUE = "conformance-secret-value"


def _admin_headers() -> dict:
    return {"Authorization": f"Bearer {ADMIN_KEY}"}


@pytest.fixture(scope="session", autouse=True)
def _require_backend() -> None:
    if not ADMIN_KEY:
        pytest.skip("AUTHORYXOS_ADMIN_KEY not set; skipping conformance suite.")
    try:
        r = httpx.get(f"{BASE_URL}/health", timeout=5)
        r.raise_for_status()
    except Exception as exc:  # pragma: no cover
        pytest.skip(f"backend not reachable at {BASE_URL}: {exc}")
    # Ensure the conformance secret exists.
    httpx.post(
        f"{BASE_URL}/v1/admin/keys",
        headers=_admin_headers(),
        json={"key_name": CONFORMANCE_KEY, "value": CONFORMANCE_VALUE},
        timeout=10,
    )


@pytest.fixture
def base_url() -> str:
    return BASE_URL


@pytest.fixture
def admin_key() -> str:
    return ADMIN_KEY


def nonce() -> str:
    return secrets.token_hex(12)


def now_iso(offset_seconds: int = 0) -> str:
    dt = datetime.now(timezone.utc) + timedelta(seconds=offset_seconds)
    return dt.isoformat().replace("+00:00", "Z")


def intent_payload(key=CONFORMANCE_KEY, *, policy="require_approval", **over) -> dict:
    body = {
        "key_name": key,
        "intent": "conformance check",
        "agent_id": "conformance-agent",
        "session_id": "conformance-session",
        "nonce": nonce(),
        "timestamp": now_iso(),
        "policy_hint": policy,
    }
    body.update(over)
    return body
