"""Typed errors surfaced by the AuthoryxOS SDK."""

from __future__ import annotations


class AuthoryxOSError(Exception):
    """Base class for all AuthoryxOS errors."""


class InvalidIntentError(AuthoryxOSError):
    """The intent payload failed validation before being sent."""


class AccessDeniedError(AuthoryxOSError):
    """The owner explicitly denied the request."""

    def __init__(self, message: str, *, reason: str = "", token: str = "") -> None:
        super().__init__(message)
        self.reason = reason
        self.token = token


class PendingTimeoutError(AuthoryxOSError):
    """Polling for a pending request exceeded the configured timeout."""

    def __init__(self, message: str, *, token: str = "") -> None:
        super().__init__(message)
        self.token = token


class TransportError(AuthoryxOSError):
    """Non-decision protocol error (network, server fault, replay, etc.)."""

    def __init__(self, message: str, *, code: str = "", retryable: bool = False) -> None:
        super().__init__(message)
        self.code = code
        self.retryable = retryable
