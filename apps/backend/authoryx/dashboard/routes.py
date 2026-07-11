"""Owner dashboard — server-rendered approval console (Jinja + HTMX).

Authentication is a single owner password (per deployment) that establishes
a signed-cookie session. The dashboard operates within the deployment's
default tenant. Richer multi-user auth belongs to the hosted product.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import APIRouter, Form, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from itsdangerous import BadSignature, URLSafeSerializer
from sqlalchemy import select

from ..core.clock import to_iso
from ..core.config import settings
from ..core.db import get_session
from ..core.security import (
    constant_time_equals,
    generate_api_key,
    hash_api_key,
    key_last4,
    key_prefix,
)
from ..models import Agent, ApiKey, Request as RequestRow, Secret, Tenant
from ..services import requests as req_service
from ..services import secret_store

router = APIRouter(tags=["dashboard"])

_TEMPLATES = Jinja2Templates(directory=str(Path(__file__).parent / "templates"))
_COOKIE = "authoryx_session"


def _serializer() -> URLSafeSerializer:
    return URLSafeSerializer(settings.session_secret, salt="dashboard")


def _default_tenant_id(db) -> str | None:
    return db.scalar(select(Tenant.id).order_by(Tenant.created_at).limit(1))


def _session_tenant(request: Request, db) -> str | None:
    raw = request.cookies.get(_COOKIE)
    if not raw:
        return None
    try:
        data = _serializer().loads(raw)
    except BadSignature:
        return None
    tid = data.get("tenant_id")
    # Confirm the tenant still exists.
    if tid and db.scalar(select(Tenant.id).where(Tenant.id == tid)):
        return tid
    return None


# ── Auth ───────────────────────────────────────────────────────────────────────

@router.get("/dashboard/login", response_class=HTMLResponse)
def login_form(request: Request) -> Any:
    return _TEMPLATES.TemplateResponse(request, "login.html", {"error": None})


@router.post("/dashboard/login")
def login(request: Request, password: str = Form(...)) -> Any:
    if not constant_time_equals(password, settings.owner_password):
        return _TEMPLATES.TemplateResponse(
            request, "login.html", {"error": "Incorrect password."}, status_code=401
        )
    db = next(get_session())
    try:
        tid = _default_tenant_id(db)
    finally:
        db.close()
    if not tid:
        return _TEMPLATES.TemplateResponse(
            request, "login.html", {"error": "No tenant configured. Run bootstrap/seed first."},
            status_code=500,
        )
    resp = RedirectResponse(url="/dashboard", status_code=303)
    resp.set_cookie(
        _COOKIE,
        _serializer().dumps({"tenant_id": tid}),
        httponly=True,
        samesite="lax",
        secure=settings.env == "prod",
        max_age=60 * 60 * 12,
    )
    return resp


@router.get("/dashboard/logout")
def logout() -> Any:
    resp = RedirectResponse(url="/dashboard/login", status_code=303)
    resp.delete_cookie(_COOKIE)
    return resp


# ── Console ──────────────────────────────────────────────────────────────────────

@router.get("/", response_class=HTMLResponse)
def root() -> Any:
    return RedirectResponse(url="/dashboard", status_code=307)


@router.get("/dashboard", response_class=HTMLResponse)
def index(request: Request) -> Any:
    db = next(get_session())
    try:
        tid = _session_tenant(request, db)
        if not tid:
            return RedirectResponse(url="/dashboard/login", status_code=303)

        pending = list(
            db.scalars(
                select(RequestRow)
                .where(RequestRow.tenant_id == tid, RequestRow.status == "pending")
                .order_by(RequestRow.requested_at.desc())
            )
        )
        recent = list(
            db.scalars(
                select(RequestRow)
                .where(RequestRow.tenant_id == tid, RequestRow.status != "pending")
                .order_by(RequestRow.requested_at.desc())
                .limit(25)
            )
        )
        secrets = secret_store.list_names(db, tid)
        agents = list(db.scalars(select(Agent).where(Agent.tenant_id == tid)))
        api_keys = list(db.scalars(select(ApiKey).where(ApiKey.tenant_id == tid)))
        issued = request.query_params.get("issued")
        return _TEMPLATES.TemplateResponse(
            request,
            "index.html",
            {
                "pending": pending,
                "recent": recent,
                "secrets": secrets,
                "agents": agents,
                "api_keys": api_keys,
                "issued_key": issued,
                "to_iso": to_iso,
                "env": settings.env,
            },
        )
    finally:
        db.close()


@router.post("/dashboard/decide/{token}")
def decide(token: str, request: Request, decision: str = Form(...), reason: str = Form("")) -> Any:
    db = next(get_session())
    try:
        tid = _session_tenant(request, db)
        if not tid:
            return RedirectResponse(url="/dashboard/login", status_code=303)
        req = req_service.get_request(db, token, tenant_id=tid)
        if req and req.status == "pending" and not req_service.expire_if_due(db, req):
            if decision == "approve":
                req_service.approve(db, req, decision_by="owner")
            else:
                req_service.deny(db, req, reason=reason or "denied via dashboard", decision_by="owner")
        db.commit()
    finally:
        db.close()
    return RedirectResponse(url="/dashboard", status_code=303)


@router.post("/dashboard/secrets")
def add_secret(
    request: Request,
    key_name: str = Form(...),
    value: str = Form(...),
    description: str = Form(""),
    default_policy: str = Form(""),
) -> Any:
    db = next(get_session())
    try:
        tid = _session_tenant(request, db)
        if not tid:
            return RedirectResponse(url="/dashboard/login", status_code=303)
        secret_store.upsert(
            db,
            tenant_id=tid,
            key_name=key_name.strip(),
            value=value,
            description=description,
            default_policy=default_policy or None,
            source="dashboard",
        )
        db.commit()
    finally:
        db.close()
    return RedirectResponse(url="/dashboard", status_code=303)


@router.post("/dashboard/secrets/{key_name}/delete")
def remove_secret(key_name: str, request: Request) -> Any:
    db = next(get_session())
    try:
        tid = _session_tenant(request, db)
        if not tid:
            return RedirectResponse(url="/dashboard/login", status_code=303)
        secret_store.delete(db, tid, key_name)
        db.commit()
    finally:
        db.close()
    return RedirectResponse(url="/dashboard", status_code=303)


@router.post("/dashboard/api-keys")
def issue_key(
    request: Request,
    label: str = Form(""),
    scope: str = Form("agent"),
) -> Any:
    db = next(get_session())
    try:
        tid = _session_tenant(request, db)
        if not tid:
            return RedirectResponse(url="/dashboard/login", status_code=303)
        plaintext = generate_api_key()
        db.add(
            ApiKey(
                tenant_id=tid,
                key_hash=hash_api_key(plaintext),
                prefix=key_prefix(plaintext),
                last4=key_last4(plaintext),
                label=label,
                scope=scope if scope in ("agent", "admin") else "agent",
                allowed_keys=[],
            )
        )
        db.commit()
    finally:
        db.close()
    # Show the plaintext once via a query param (owner-only page).
    return RedirectResponse(url=f"/dashboard?issued={plaintext}", status_code=303)
