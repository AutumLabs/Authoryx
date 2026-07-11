"""HTTP transport. Thin wrapper over httpx with explicit error mapping.

This module never logs the response body — responses may contain
secret values.
"""

from __future__ import annotations

from typing import Any

import httpx

from .errors import AccessDeniedError, TransportError


def map_error(payload: dict[str, Any], status: int, *, token: str = "") -> Exception:
    err = payload.get("error", {}) if isinstance(payload, dict) else {}
    code = err.get("code", f"http_{status}")
    message = err.get("message", f"HTTP {status}")
    retryable = bool(err.get("retryable", False))
    if code == "denied":
        return AccessDeniedError(message, reason=message, token=token)
    return TransportError(message, code=code, retryable=retryable)


async def request_json(
    client: httpx.AsyncClient,
    method: str,
    url: str,
    *,
    json: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
) -> tuple[int, dict[str, Any]]:
    try:
        resp = await client.request(method, url, json=json, headers=headers)
    except httpx.HTTPError as e:
        raise TransportError(f"network error: {e.__class__.__name__}", code="network", retryable=True) from e
    try:
        body: dict[str, Any] = resp.json() if resp.content else {}
    except ValueError as e:
        raise TransportError("invalid JSON response", code="invalid_response") from e
    return resp.status_code, body
