"""FastAPI app implementing the Authoryx protocol for local development."""

from __future__ import annotations

import os
import re
import secrets as _secrets
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel, Field, ValidationError

from . import db, nonce, secrets

load_dotenv()
db.init_db()

API_KEY_RE = re.compile(r"^axos_live_[A-Za-z0-9]{20,}$")
KEY_NAME_RE = re.compile(r"^[A-Z][A-Z0-9_]{0,127}$")
NONCE_RE = re.compile(r"^[0-9a-f]{24}$")
CLOCK_SKEW_S = 5 * 60
PENDING_TTL_S = 60 * 60
POLL_INTERVAL_S = 5

app = FastAPI(title="AuthoryxOS Mock Backend", version="0.1.0")

_TEMPLATES_DIR = Path(__file__).resolve().parent.parent / "templates"
templates = Jinja2Templates(directory=str(_TEMPLATES_DIR))


def _auto_approve() -> bool:
    return os.environ.get("MOCK_AUTO_APPROVE", "true").lower() == "true"


def _owner_token() -> str:
    return os.environ.get("MOCK_OWNER_TOKEN", "change-me")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _err(code: str, message: str, http: int, retryable: bool = False) -> JSONResponse:
    return JSONResponse(
        status_code=http,
        content={"error": {"code": code, "message": message, "retryable": retryable}},
    )


def _new_token() -> str:
    return f"pending_{_secrets.token_urlsafe(18)}"


def _new_audit_id() -> str:
    return f"audit_{_secrets.token_urlsafe(12)}"


class IntentRequest(BaseModel):
    api_key: str
    key_name: str = Field(default="")
    intent: str = Field(min_length=1, max_length=4096)
    agent_id: str = Field(max_length=128)
    session_id: str = Field(max_length=128)
    nonce: str
    timestamp: str
    policy_hint: str | None = None


def _extract_api_key(body_key: str, authorization: str | None) -> str | None:
    if authorization and authorization.lower().startswith("bearer "):
        return authorization[7:].strip()
    return body_key or None


@app.post("/v1/os/secrets/{key_name}")
async def submit_intent(
    key_name: str,
    request: Request,
    authorization: str | None = Header(default=None),
) -> Any:
    try:
        payload = await request.json()
    except Exception:
        return _err("invalid_intent", "Body must be JSON.", 400)

    try:
        req = IntentRequest(**payload)
    except ValidationError as e:
        return _err("invalid_intent", f"Schema error: {e.errors()[0]['msg']}", 400)

    api_key = _extract_api_key(req.api_key, authorization)
    if not api_key or not API_KEY_RE.match(api_key):
        return _err("invalid_api_key", "API key missing or malformed.", 401)

    if not KEY_NAME_RE.match(key_name):
        return _err("invalid_intent", "key_name must be SCREAMING_SNAKE_CASE.", 400)

    if not NONCE_RE.match(req.nonce):
        return _err("invalid_intent", "nonce must be 24 hex chars.", 400)

    try:
        ts = datetime.fromisoformat(req.timestamp.replace("Z", "+00:00"))
    except Exception:
        return _err("invalid_intent", "timestamp must be RFC 3339.", 400)
    if abs((_now() - ts).total_seconds()) > CLOCK_SKEW_S:
        return _err("clock_skew", "Timestamp skew exceeds 5 minutes.", 400)

    if not nonce.record_or_reject(api_key, req.nonce):
        return _err("replayed_nonce", "This nonce has already been used.", 400)

    if secrets.get_secret(key_name) is None:
        return _err("unknown_key", f"Key '{key_name}' is not configured.", 404)

    token = _new_token()
    now = _now()
    expires_at = now + timedelta(seconds=PENDING_TTL_S)
    client_ip = request.client.host if request.client else ""

    with db.connect() as conn:
        conn.execute(
            """
            INSERT INTO requests
              (token, api_key, key_name, intent, agent_id, session_id, nonce,
               requested_at, expires_at, status, ip_address)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
            """,
            (
                token, api_key, key_name, req.intent, req.agent_id, req.session_id,
                req.nonce, _iso(now), _iso(expires_at), client_ip,
            ),
        )

    if _auto_approve():
        return _approve_locked(token, decision_by="auto")

    return {
        "status": "pending",
        "token": token,
        "poll_url": f"/v1/os/pending/{token}",
        "poll_interval_seconds": POLL_INTERVAL_S,
        "expires_at": _iso(expires_at),
    }


def _approve_locked(token: str, decision_by: str) -> dict[str, Any]:
    now = _now()
    audit_id = _new_audit_id()
    with db.connect() as conn:
        row = conn.execute(
            "SELECT key_name, status, expires_at FROM requests WHERE token = ?",
            (token,),
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Unknown token.")
        if row["status"] in ("approved", "denied"):
            raise HTTPException(status_code=409, detail=f"Already {row['status']}.")
        conn.execute(
            """UPDATE requests
               SET status='approved', decision_by=?, decided_at=?, audit_id=?
               WHERE token=?""",
            (decision_by, _iso(now), audit_id, token),
        )
        key_name = row["key_name"]
    secret = secrets.get_secret(key_name) or ""
    return {
        "status": "approved",
        "token": token,
        "secret": secret,
        "decision_by": decision_by,
        "decided_at": _iso(now),
        "audit_id": audit_id,
    }


def _deny_locked(token: str, reason: str, decision_by: str) -> dict[str, Any]:
    now = _now()
    audit_id = _new_audit_id()
    with db.connect() as conn:
        row = conn.execute(
            "SELECT status FROM requests WHERE token = ?", (token,)
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Unknown token.")
        if row["status"] in ("approved", "denied"):
            raise HTTPException(status_code=409, detail=f"Already {row['status']}.")
        conn.execute(
            """UPDATE requests
               SET status='denied', decision_by=?, decided_at=?, reason=?, audit_id=?
               WHERE token=?""",
            (decision_by, _iso(now), reason, audit_id, token),
        )
    return {
        "status": "denied",
        "token": token,
        "reason": reason,
        "decided_at": _iso(now),
        "audit_id": audit_id,
    }


@app.get("/v1/os/pending/{token}")
async def poll(token: str) -> Any:
    with db.connect() as conn:
        row = conn.execute(
            """SELECT token, status, expires_at, key_name, reason,
                      decision_by, decided_at, audit_id
               FROM requests WHERE token = ?""",
            (token,),
        ).fetchone()
    if row is None:
        return _err("expired_token", "Unknown or expired token.", 410)

    expires_at = datetime.fromisoformat(row["expires_at"].replace("Z", "+00:00"))
    if row["status"] == "pending" and _now() > expires_at:
        with db.connect() as conn:
            conn.execute(
                "UPDATE requests SET status='expired' WHERE token=?", (token,)
            )
        return _err("expired_token", "Pending request expired.", 410)

    status = row["status"]
    if status == "pending":
        return {
            "status": "pending",
            "token": token,
            "poll_url": f"/v1/os/pending/{token}",
            "poll_interval_seconds": POLL_INTERVAL_S,
            "expires_at": row["expires_at"],
        }
    if status == "approved":
        secret = secrets.get_secret(row["key_name"]) or ""
        return {
            "status": "approved",
            "token": token,
            "secret": secret,
            "decision_by": row["decision_by"] or "owner",
            "decided_at": row["decided_at"],
            "audit_id": row["audit_id"],
        }
    if status == "denied":
        return {
            "status": "denied",
            "token": token,
            "reason": row["reason"] or "",
            "decided_at": row["decided_at"],
            "audit_id": row["audit_id"],
        }
    return _err("expired_token", "Pending request expired.", 410)


class Decision(BaseModel):
    decision: str
    reason: str | None = None


@app.post("/v1/os/decisions/{token}")
async def decide(
    token: str,
    body: Decision,
    authorization: str | None = Header(default=None),
) -> Any:
    if not authorization or authorization != f"Bearer {_owner_token()}":
        raise HTTPException(status_code=401, detail="Owner token required.")
    if body.decision == "approve":
        return _approve_locked(token, decision_by="owner")
    if body.decision == "deny":
        return _deny_locked(token, body.reason or "denied", decision_by="owner")
    raise HTTPException(status_code=400, detail="decision must be 'approve' or 'deny'.")


@app.get("/v1/os/audit")
async def audit(limit: int = 50) -> Any:
    limit = max(1, min(500, limit))
    with db.connect() as conn:
        rows = conn.execute(
            """SELECT audit_id, agent_id, session_id, key_name, intent, status,
                      decision_by, requested_at, decided_at, ip_address, nonce
               FROM requests
               ORDER BY requested_at DESC
               LIMIT ?""",
            (limit,),
        ).fetchall()
    return {
        "records": [
            {
                "audit_id": r["audit_id"] or "",
                "agent_id": r["agent_id"],
                "session_id": r["session_id"],
                "key_name": r["key_name"],
                "intent": r["intent"],
                "decision": r["status"],
                "decided_by": r["decision_by"] or "",
                "requested_at": r["requested_at"],
                "decided_at": r["decided_at"] or "",
                "ip_address": r["ip_address"] or "",
                "nonce": r["nonce"],
            }
            for r in rows
        ]
    }


# -------- Operator UI --------

@app.get("/", response_class=HTMLResponse)
async def index(request: Request) -> Any:
    with db.connect() as conn:
        pending = conn.execute(
            """SELECT token, key_name, intent, agent_id, requested_at, expires_at
               FROM requests WHERE status='pending'
               ORDER BY requested_at DESC"""
        ).fetchall()
        recent = conn.execute(
            """SELECT token, key_name, status, decided_at, intent
               FROM requests WHERE status != 'pending'
               ORDER BY requested_at DESC LIMIT 20"""
        ).fetchall()
    return templates.TemplateResponse(
        "index.html",
        {
            "request": request,
            "pending": [dict(r) for r in pending],
            "recent": [dict(r) for r in recent],
            "auto": _auto_approve(),
        },
    )


@app.post("/ui/decide/{token}")
async def ui_decide(token: str, request: Request) -> Any:
    form = await request.form()
    decision = form.get("decision", "")
    reason = form.get("reason", "") or "denied via UI"
    if decision == "approve":
        _approve_locked(token, decision_by="owner")
    elif decision == "deny":
        _deny_locked(token, str(reason), decision_by="owner")
    return RedirectResponse(url="/", status_code=303)
