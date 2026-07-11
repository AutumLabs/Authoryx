"""`authoryxos_fetch_secret` Hermes tool handler.

Same semantics as the OpenClaw and Claude Code plugins:

- `intent` is mandatory; the AuthoryxOS owner reads it to approve or deny.
- AccessDeniedError and other AuthoryxOSError subclasses map to a
  structured `ok: false` result rather than being thrown. The agent
  reads the error and decides what to do next.
- The revealed secret value is returned only in the result dict; the
  SecretStr wrapper is zeroed before the handler returns.
"""

from __future__ import annotations

from typing import Any

from authoryxos import AccessDeniedError, AuthoryxOSError

from .runtime import client

NAME = "authoryxos_fetch_secret"
DESCRIPTION = (
    "Fetch a named secret from AuthoryxOS. The 'intent' field is mandatory — "
    "describe in plain language why the secret is needed. The system owner "
    "reads the intent to approve or deny the fetch. On denial the tool "
    "returns {ok: false, error: {...}} rather than raising."
)
SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": ["key", "intent"],
    "additionalProperties": False,
    "properties": {
        "key": {
            "type": "string",
            "pattern": r"^[A-Z][A-Z0-9_]{0,127}$",
            "description": "SCREAMING_SNAKE_CASE name of the secret to fetch.",
        },
        "intent": {
            "type": "string",
            "minLength": 1,
            "maxLength": 4096,
            "description": "Plain-language reason this secret is needed right now.",
        },
    },
}


async def handler(args: dict[str, Any]) -> dict[str, Any]:
    """Hermes-compatible async tool handler.

    Hermes' registry invokes async handlers with the parsed argument dict
    and expects a JSON-serializable dict back.
    """
    key = args.get("key", "")
    intent = args.get("intent", "")
    if not key or not intent:
        return {
            "ok": False,
            "error": {
                "code": "invalid_intent",
                "message": "Both 'key' and 'intent' are required.",
            },
        }
    try:
        secret = await client().fetch(key=key, intent=intent)
    except AccessDeniedError as e:
        return {"ok": False, "error": {"code": "denied", "message": e.reason or "denied"}}
    except AuthoryxOSError as e:
        return {
            "ok": False,
            "error": {"code": e.__class__.__name__, "message": str(e)},
        }
    try:
        return {"ok": True, "value": secret.reveal()}
    finally:
        secret.zero()


def check() -> bool:
    """Hermes availability probe — returns True if AUTHORYXOS_API_KEY is set."""
    import os
    return bool(os.environ.get("AUTHORYXOS_API_KEY"))
