"""
The Authoryx agent API client, on the standard library only.

Every call signs in with the agent id and key and sends ``User-Agent:
authoryx-sdk-py/<version>`` and nothing about the machine or the person. A
refusal raises AuthoryxError; a 429 with a reset is waited out and retried for
at most ``max_retry_wait_seconds`` in total.

``fetch()`` is T1, "Fetch for scripts": the value reaches the program that
calls it. Code that runs inside an agent's conversation should use
``authoryx run`` or the MCP server instead.
"""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Callable, Dict, List, Optional

from ._version import VERSION
from .errors import AuthoryxError

SUPPORTED_API_VERSIONS = (1,)
AGENT_API_PATH = "/agent/v1/os"
HINTS = ("once", "1h", "always")
OUTCOMES = ("done", "abandoned", "failed")


class Authoryx:
    def __init__(
        self,
        agent_id: str,
        agent_key: str,
        api_url: str,
        *,
        user_agent: Optional[str] = None,
        max_retry_wait_seconds: int = 60,
        timeout: float = 30.0,
        on_call: Optional[Callable[[Dict[str, Any]], None]] = None,
    ) -> None:
        if not agent_id:
            raise AuthoryxError("invalid", "AUTHORYX_NO_AGENT", 0, "An agent id is required.")
        if not agent_key:
            raise AuthoryxError("invalid", "AUTHORYX_NO_KEY", 0, "An agent key is required.")
        if not api_url:
            raise AuthoryxError("invalid", "AUTHORYX_NO_API", 0, "The Authoryx API address is required.")
        self.api_url = api_url.rstrip("/")
        self.agent_id = agent_id
        self.__key = agent_key
        self._user_agent = user_agent or f"authoryx-sdk-py/{VERSION}"
        self._max_retry_wait = max_retry_wait_seconds
        self._timeout = timeout
        self._on_call = on_call

    def __repr__(self) -> str:
        return f"Authoryx(agent_id={self.agent_id!r}, api_url={self.api_url!r})"

    # -- calls ----------------------------------------------------------------

    def whoami(self) -> Dict[str, Any]:
        """Who this agent is; raises ``version_unsupported`` for an API version this release does not speak."""
        me = self._call("GET", "/whoami")
        if me.get("apiVersion") not in SUPPORTED_API_VERSIONS:
            raise AuthoryxError(
                "version_unsupported",
                "AUTHORYX_VERSION_UNSUPPORTED",
                0,
                f"The Authoryx API speaks version {me.get('apiVersion')}; this release supports "
                f"{', '.join(str(v) for v in SUPPORTED_API_VERSIONS)}. Upgrade the Authoryx tools.",
            )
        return me

    def circles(self) -> List[Dict[str, Any]]:
        return self._call("GET", "/circles")["circles"]

    def secrets(self, circle_id: str) -> Dict[str, Any]:
        return self._call("GET", f"/circles/{_q(circle_id)}/secrets")

    def request(self, circle_id: str, key_names: List[str], reason: str, hint: Optional[str] = None) -> Dict[str, Any]:
        body: Dict[str, Any] = {"circleId": circle_id, "keyNames": list(key_names), "reason": reason}
        if hint is not None:
            body["hint"] = hint
        return self._call("POST", "/requests", body)["request"]

    def get_request(self, request_id: str) -> Dict[str, Any]:
        return self._call("GET", f"/requests/{_q(request_id)}")["request"]

    def wait_for_request(self, request_id: str, seconds: float = 60, interval: float = 2.0) -> Dict[str, Any]:
        """Read the request until it is no longer pending or ``seconds`` pass, at most once every ``interval``."""
        deadline = time.monotonic() + max(0.0, seconds)
        r = self.get_request(request_id)
        while r["state"] == "pending" and time.monotonic() < deadline:
            time.sleep(min(max(0.01, interval), max(0.0, deadline - time.monotonic())))
            r = self.get_request(request_id)
        return r

    def close_request(self, request_id: str, outcome: str = "done") -> Dict[str, Any]:
        return self._call("POST", f"/requests/{_q(request_id)}/close", {"outcome": outcome})["request"]

    def fetch(self, request_id: str, key_name: str) -> Dict[str, Any]:
        """T1, Fetch for scripts: the value reaches this program."""
        return self._call("POST", f"/requests/{_q(request_id)}/fetch", {"keyName": key_name})["value"]

    # -- transport ------------------------------------------------------------

    def _call(self, method: str, route: str, body: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        waited = 0
        while True:
            headers = {
                "Authoryx-Agent": self.agent_id,
                "Authorization": f"Bearer {self.__key}",
                "User-Agent": self._user_agent,
                "Accept": "application/json",
            }
            data = None
            if body is not None:
                headers["Content-Type"] = "application/json"
                data = json.dumps(body).encode("utf-8")
            req = urllib.request.Request(f"{self.api_url}{AGENT_API_PATH}{route}", data=data, method=method, headers=headers)
            started = time.monotonic()
            try:
                with urllib.request.urlopen(req, timeout=self._timeout) as res:
                    status, raw, res_headers = res.status, res.read(), res.headers
            except urllib.error.HTTPError as e:
                status, raw, res_headers = e.code, e.read(), e.headers
            except (urllib.error.URLError, OSError) as e:
                self._report(method, route, 0, started)
                reason = getattr(e, "reason", e)
                raise AuthoryxError("network", "AUTHORYX_NETWORK", 0, f"Could not reach the Authoryx API at {self.api_url}: {reason}") from None
            self._report(method, route, status, started)
            try:
                parsed = json.loads(raw.decode("utf-8")) if raw else None
            except ValueError:
                parsed = None
            if 200 <= status < 300 and isinstance(parsed, dict) and parsed.get("success"):
                return parsed["data"]
            reset = _retry_seconds(res_headers)
            err = AuthoryxError.from_response(status, parsed, reset)
            if err.kind == "rate_limited" and reset is not None and waited + reset <= self._max_retry_wait:
                waited += reset
                time.sleep(reset)
                continue
            raise err

    def _report(self, method: str, route: str, status: int, started: float) -> None:
        if self._on_call:
            self._on_call({"method": method, "route": route, "status": status, "durationMs": round((time.monotonic() - started) * 1000)})


def _q(s: str) -> str:
    return urllib.parse.quote(s, safe="")


def _retry_seconds(headers: Any) -> Optional[int]:
    if headers is None:
        return None
    for name in ("ratelimit-reset", "retry-after"):
        v = headers.get(name)
        if v and str(v).strip().isdigit():
            return max(1, int(str(v).strip()))
    return None
