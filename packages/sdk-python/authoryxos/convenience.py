"""Module-level convenience helpers.

These exist so code migrated by ``authoryxos migrate`` reads cleanly:

    from authoryxos import fetch
    API_KEY = fetch("STRIPE_KEY", intent="charge customer for order")

``fetch`` builds a :class:`Client` from the environment
(``AUTHORYXOS_API_KEY``, ``AUTHORYXOS_BASE_URL``) and returns the revealed
value — the drop-in equivalent of a hardcoded string, but fetched on demand
with intent, approval, and audit. For stronger hygiene (no raw string in a
local variable) use ``Client.with_secret(...)`` instead.
"""

from __future__ import annotations

import os

from .client import Client
from .secretstr import SecretStr


def _client_from_env() -> Client:
    api_key = os.environ.get("AUTHORYXOS_API_KEY")
    if not api_key:
        raise RuntimeError(
            "AUTHORYXOS_API_KEY is not set — required to fetch secrets at runtime."
        )
    kwargs: dict = {}
    if os.environ.get("AUTHORYXOS_BASE_URL"):
        kwargs["base_url"] = os.environ["AUTHORYXOS_BASE_URL"]
    if os.environ.get("AUTHORYXOS_AGENT_ID"):
        kwargs["agent_id"] = os.environ["AUTHORYXOS_AGENT_ID"]
    if os.environ.get("AUTHORYXOS_SESSION_ID"):
        kwargs["session_id"] = os.environ["AUTHORYXOS_SESSION_ID"]
    return Client(api_key, **kwargs)


def fetch_secret(key: str, intent: str, *, policy: str | None = None) -> SecretStr:
    """Fetch a secret and return the :class:`SecretStr` wrapper."""
    return _client_from_env().fetch(key=key, intent=intent, policy=policy)


def fetch(key: str, intent: str, *, policy: str | None = None) -> str:
    """Fetch a secret and return the revealed plaintext (drop-in for a literal)."""
    return fetch_secret(key, intent, policy=policy).reveal()
