"""AuthoryxOS SDK client.

Two classes are provided:

- `AsyncClient` — the async-native implementation. Use this directly from
  async agent frameworks.
- `Client` — a synchronous wrapper around `AsyncClient` for non-async
  call sites.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, TypeVar

import httpx

from . import intent as _intent
from . import transport as _transport
from .errors import (
    AccessDeniedError,
    AuthoryxOSError,
    PendingTimeoutError,
    TransportError,
)
from .pause import PauseStore, PendingRow
from .secretstr import SecretStr

T = TypeVar("T")

DEFAULT_TIMEOUT_S = 3600
DEFAULT_POLL_S = 5


class AsyncClient:
    """Async AuthoryxOS client."""

    def __init__(
        self,
        api_key: str,
        *,
        base_url: str = "https://api.authoryx.dev",
        agent_id: str | None = None,
        session_id: str | None = None,
        timeout_seconds: int = DEFAULT_TIMEOUT_S,
        pause_store: PauseStore | None = None,
        http_client: httpx.AsyncClient | None = None,
    ) -> None:
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.agent_id = agent_id
        self.session_id = session_id
        self.timeout_seconds = timeout_seconds
        self.pause = pause_store or PauseStore()
        self._owns_http = http_client is None
        self._http = http_client or httpx.AsyncClient(timeout=30.0)

    async def aclose(self) -> None:
        if self._owns_http:
            await self._http.aclose()

    async def __aenter__(self) -> "AsyncClient":
        return self

    async def __aexit__(self, *_exc: object) -> None:
        await self.aclose()

    async def fetch(
        self,
        *,
        key: str,
        intent: str,
        policy: str | None = None,
    ) -> SecretStr:
        """Submit an intent request and return the secret.

        Raises:
            InvalidIntentError: payload validation failed before sending.
            AccessDeniedError: owner denied the request.
            PendingTimeoutError: polling exceeded `timeout_seconds`.
            TransportError: protocol or network failure.
        """
        req = _intent.build(
            api_key=self.api_key,
            key_name=key,
            intent=intent,
            agent_id=self.agent_id,
            session_id=self.session_id,
            policy=policy,
        )
        url = f"{self.base_url}/v1/os/secrets/{key}"
        headers = {"Authorization": f"Bearer {self.api_key}"}
        status, body = await _transport.request_json(
            self._http, "POST", url, json=req.to_dict(), headers=headers,
        )
        return await self._resolve(status, body, key=key, agent_id=req.agent_id, session_id=req.session_id)

    async def _resolve(
        self,
        status: int,
        body: dict[str, Any],
        *,
        key: str,
        agent_id: str,
        session_id: str,
    ) -> SecretStr:
        if status >= 400:
            raise _transport.map_error(body, status)

        result_status = body.get("status")
        if result_status == "approved":
            return SecretStr(body["secret"])
        if result_status == "denied":
            raise AccessDeniedError(
                body.get("reason") or "request denied",
                reason=body.get("reason", ""),
                token=body.get("token", ""),
            )
        if result_status == "pending":
            token = body["token"]
            row = PendingRow(
                token=token,
                base_url=self.base_url,
                poll_url=body["poll_url"],
                poll_interval=int(body.get("poll_interval_seconds", DEFAULT_POLL_S)),
                expires_at=body["expires_at"],
                key_name=key,
                agent_id=agent_id,
                session_id=session_id,
                created_at=datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            )
            self.pause.save(row)
            return await self._poll(row)

        raise TransportError(f"unexpected response status: {result_status!r}", code="invalid_response")

    async def _poll(self, row: PendingRow) -> SecretStr:
        url = f"{row.base_url}{row.poll_url}"
        headers = {"Authorization": f"Bearer {self.api_key}"}
        deadline = asyncio.get_event_loop().time() + self.timeout_seconds
        while True:
            status, body = await _transport.request_json(self._http, "GET", url, headers=headers)
            if status >= 400:
                self.pause.delete(row.token)
                raise _transport.map_error(body, status, token=row.token)
            s = body.get("status")
            if s == "approved":
                secret = body["secret"]
                self.pause.delete(row.token)
                return SecretStr(secret)
            if s == "denied":
                self.pause.delete(row.token)
                raise AccessDeniedError(
                    body.get("reason") or "request denied",
                    reason=body.get("reason", ""),
                    token=row.token,
                )
            if asyncio.get_event_loop().time() >= deadline:
                raise PendingTimeoutError(
                    f"timed out polling for {row.token}", token=row.token,
                )
            await asyncio.sleep(row.poll_interval)

    async def with_secret(
        self,
        *,
        key: str,
        intent: str,
        exec: Callable[[str], T | Awaitable[T]],
        policy: str | None = None,
    ) -> T:
        """Fetch the secret, pass it to `exec`, then zero the wrapper.

        The secret is never returned to the caller.
        """
        s = await self.fetch(key=key, intent=intent, policy=policy)
        try:
            result = exec(s.reveal())
            if asyncio.iscoroutine(result):
                result = await result
            return result  # type: ignore[return-value]
        finally:
            s.zero()

    async def resume_pending(self) -> list[tuple[str, AuthoryxOSError | SecretStr]]:
        """Re-attach to all pending tokens persisted in the local pause store.

        Returns a list of `(token, result)` pairs, where `result` is either
        a `SecretStr` for approved requests or an `AuthoryxOSError`.
        """
        out: list[tuple[str, AuthoryxOSError | SecretStr]] = []
        for row in self.pause.all():
            if row.base_url != self.base_url:
                continue
            try:
                out.append((row.token, await self._poll(row)))
            except AuthoryxOSError as e:
                out.append((row.token, e))
        return out


class Client:
    """Synchronous wrapper around `AsyncClient`."""

    def __init__(self, api_key: str, **kwargs: Any) -> None:
        self._async = AsyncClient(api_key, **kwargs)

    def fetch(self, *, key: str, intent: str, policy: str | None = None) -> SecretStr:
        return asyncio.run(self._async.fetch(key=key, intent=intent, policy=policy))

    def with_secret(
        self,
        *,
        key: str,
        intent: str,
        exec: Callable[[str], T],
        policy: str | None = None,
    ) -> T:
        return asyncio.run(
            self._async.with_secret(key=key, intent=intent, exec=exec, policy=policy)
        )

    def resume_pending(self) -> list[tuple[str, AuthoryxOSError | SecretStr]]:
        return asyncio.run(self._async.resume_pending())

    def close(self) -> None:
        asyncio.run(self._async.aclose())
