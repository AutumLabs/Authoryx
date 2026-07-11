"""Lazy AuthoryxOS Client singleton for the Hermes plugin.

Mirrors `plugins/openclaw/src/runtime.ts` and
`plugins/claude-code/src/runtime.ts` — same `configure` / `client` /
`attach` / `_reset` surface so the tests look the same across plugins.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Optional

from authoryxos import AsyncClient

_client: Optional[AsyncClient] = None


@dataclass
class PluginConfig:
    api_key: str
    base_url: Optional[str] = None
    agent_id: Optional[str] = None
    session_id: Optional[str] = None


def configure(cfg: PluginConfig) -> AsyncClient:
    global _client
    kwargs: dict[str, object] = {
        "base_url": cfg.base_url or "https://api.authoryx.dev",
    }
    if cfg.agent_id:
        kwargs["agent_id"] = cfg.agent_id
    if cfg.session_id:
        kwargs["session_id"] = cfg.session_id
    _client = AsyncClient(cfg.api_key, **kwargs)  # type: ignore[arg-type]
    return _client


def configure_from_env() -> AsyncClient:
    api_key = os.environ.get("AUTHORYXOS_API_KEY")
    if not api_key:
        raise RuntimeError(
            "AUTHORYXOS_API_KEY is required. Set it in the environment "
            "before Hermes starts the toolset."
        )
    return configure(
        PluginConfig(
            api_key=api_key,
            base_url=os.environ.get("AUTHORYXOS_BASE_URL"),
            agent_id=os.environ.get("AUTHORYXOS_AGENT_ID"),
            session_id=os.environ.get("AUTHORYXOS_SESSION_ID"),
        )
    )


def client() -> AsyncClient:
    if _client is None:
        return configure_from_env()
    return _client


def attach(c: AsyncClient) -> None:
    """Inject a pre-built client. Used by tests."""
    global _client
    _client = c


def _reset() -> None:
    global _client
    _client = None
