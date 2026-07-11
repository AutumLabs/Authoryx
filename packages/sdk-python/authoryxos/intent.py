"""Intent request payload construction and client-side validation."""

from __future__ import annotations

import re
import secrets
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

API_KEY_RE = re.compile(r"^axos_live_[A-Za-z0-9]{20,}$")
KEY_NAME_RE = re.compile(r"^[A-Z][A-Z0-9_]{0,127}$")


@dataclass
class IntentRequest:
    api_key: str
    key_name: str
    intent: str
    agent_id: str
    session_id: str
    nonce: str
    timestamp: str
    policy_hint: str | None = None

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {
            "api_key": self.api_key,
            "key_name": self.key_name,
            "intent": self.intent,
            "agent_id": self.agent_id,
            "session_id": self.session_id,
            "nonce": self.nonce,
            "timestamp": self.timestamp,
        }
        if self.policy_hint:
            d["policy_hint"] = self.policy_hint
        return d


def build(
    *,
    api_key: str,
    key_name: str,
    intent: str,
    agent_id: str | None,
    session_id: str | None,
    policy: str | None,
) -> IntentRequest:
    if not API_KEY_RE.match(api_key):
        from .errors import InvalidIntentError
        raise InvalidIntentError("api_key must match 'axos_live_[A-Za-z0-9]{20,}'")
    if not KEY_NAME_RE.match(key_name):
        from .errors import InvalidIntentError
        raise InvalidIntentError("key_name must be SCREAMING_SNAKE_CASE")
    if not intent or len(intent) > 4096:
        from .errors import InvalidIntentError
        raise InvalidIntentError("intent must be 1–4096 chars")
    if policy not in (None, "approve_once", "always_approve", "require_approval"):
        from .errors import InvalidIntentError
        raise InvalidIntentError(f"unknown policy hint: {policy!r}")

    return IntentRequest(
        api_key=api_key,
        key_name=key_name,
        intent=intent,
        agent_id=agent_id or f"agent-{uuid.uuid4().hex[:8]}",
        session_id=session_id or f"session-{uuid.uuid4().hex[:8]}",
        nonce=secrets.token_hex(12),
        timestamp=datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        policy_hint=policy,
    )
