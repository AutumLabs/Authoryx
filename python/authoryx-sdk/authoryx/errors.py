"""One error type for every refusal, with a ``kind`` to switch on; the same kinds as the TypeScript SDK."""

from __future__ import annotations

from typing import Any, Optional

KIND_BY_CODE = {
    "AGENT_INVALID": "invalid",
    "AGENT_UNAUTHORIZED": "unauthorized",
    "AGENT_NOT_APPROVED": "not_approved",
    "AGENT_NOT_FOUND": "not_found",
    "AGENT_PENDING_LIMIT": "pending_limit",
    "RATE_LIMIT_EXCEEDED": "rate_limited",
    "AGENT_API_OFF": "api_off",
    "AGENT_UNAVAILABLE": "unavailable",
}


class AuthoryxError(Exception):
    """A refusal from the agent API, or a local failure. Never carries a value or a key."""

    def __init__(
        self,
        kind: str,
        code: str,
        status: int,
        message: str,
        state: Optional[str] = None,
        field: Optional[str] = None,
        retry_after: Optional[int] = None,
    ) -> None:
        super().__init__(message)
        self.kind = kind
        self.code = code
        self.status = status
        self.message = message
        self.state = state
        self.field = field
        self.retry_after = retry_after

    @classmethod
    def from_response(cls, status: int, body: Any, retry_after: Optional[int] = None) -> "AuthoryxError":
        data = body.get("data", {}) if isinstance(body, dict) else {}
        code = data.get("code") if isinstance(data.get("code"), str) else f"HTTP_{status}"
        message = data.get("error") if isinstance(data.get("error"), str) else f"The agent API answered {status}."
        if code in KIND_BY_CODE:
            kind = KIND_BY_CODE[code]
        elif status == 401:
            kind = "unauthorized"
        elif status == 404:
            kind = "not_found"
        elif status >= 500:
            kind = "unavailable"
        else:
            kind = "invalid"
        return cls(kind, code, status, message, data.get("state"), data.get("field"), retry_after)

    def __repr__(self) -> str:
        return f"AuthoryxError(kind={self.kind!r}, code={self.code!r}, status={self.status})"
