"""Protocol error envelope (see protocol-spec.md §6).

Raise :class:`ProtocolError` anywhere in a request; the registered handler
renders the canonical ``{"error": {code, message, retryable}}`` body with the
right HTTP status.
"""

from __future__ import annotations

from fastapi import Request
from fastapi.responses import JSONResponse

# code -> (http_status, retryable)
_ERROR_TABLE: dict[str, tuple[int, bool]] = {
    "invalid_api_key": (401, False),
    "invalid_intent": (400, False),
    "replayed_nonce": (400, False),
    "clock_skew": (400, False),
    "unknown_key": (404, False),
    "expired_token": (410, False),
    "denied": (403, False),
    "forbidden": (403, False),
    "rate_limited": (429, True),
    "internal": (500, True),
}


class ProtocolError(Exception):
    def __init__(self, code: str, message: str) -> None:
        self.code = code
        self.message = message
        self.http, self.retryable = _ERROR_TABLE.get(code, (400, False))
        super().__init__(message)

    def to_response(self) -> JSONResponse:
        return JSONResponse(
            status_code=self.http,
            content={
                "error": {
                    "code": self.code,
                    "message": self.message,
                    "retryable": self.retryable,
                }
            },
        )


async def protocol_error_handler(_request: Request, exc: ProtocolError) -> JSONResponse:
    return exc.to_response()
