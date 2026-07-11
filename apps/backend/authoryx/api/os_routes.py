"""Agent-facing protocol plane: /v1/os/* (frozen within v1).

Endpoints:
  POST /v1/os/secrets/{key_name}   submit an intent request
  GET  /v1/os/pending/{token}      poll a pending request
  POST /v1/os/decisions/{token}    owner approve/deny (admin-scoped key)
  GET  /v1/os/audit                read the audit log
"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Header, Request
from sqlalchemy import select

from ..core.clock import now, parse_iso, to_iso
from ..core.config import settings
from ..core.security import KEY_NAME_RE, NONCE_RE, parse_bearer
from ..models import Agent, AuditLog, Request as RequestRow
from ..notify import Notification, get_notifier
from ..policy import PolicyContext, get_policy_engine
from ..services import requests as req_service
from ..services import secret_store
from ..services.principal import authenticate, require_admin
from .deps import CurrentPrincipal, DbSession
from .errors import ProtocolError
from .schemas import DecisionBody, IntentRequest

router = APIRouter(prefix="/v1/os", tags=["protocol"])


@router.post("/secrets/{key_name}")
def submit_intent(
    key_name: str,
    body: IntentRequest,
    request: Request,
    db: DbSession,
    authorization: Annotated[str | None, Header()] = None,
) -> Any:
    # ── Authn + format validation ────────────────────────────────────────────
    api_key = parse_bearer(authorization, body.api_key)
    principal = authenticate(db, api_key)  # raises invalid_api_key

    if not KEY_NAME_RE.match(key_name):
        raise ProtocolError("invalid_intent", "key_name must be SCREAMING_SNAKE_CASE.")
    if not NONCE_RE.match(body.nonce):
        raise ProtocolError("invalid_intent", "nonce must be 24 hex chars.")
    try:
        ts = parse_iso(body.timestamp)
    except Exception as exc:
        raise ProtocolError("invalid_intent", "timestamp must be RFC 3339.") from exc
    if abs((now() - ts).total_seconds()) > settings.clock_skew_seconds:
        raise ProtocolError("clock_skew", "Timestamp skew exceeds the allowed window.")

    # ── Replay protection ──────────────────────────────────────────────────────
    if not req_service.record_nonce(db, principal.api_key_hash, body.nonce):
        raise ProtocolError("replayed_nonce", "This nonce has already been used.")

    # ── Scope + existence (both map to unknown_key; no existence leak) ─────────
    agent = db.scalar(
        select(Agent).where(
            Agent.tenant_id == principal.tenant_id, Agent.external_id == body.agent_id
        )
    )
    if not principal.may_fetch(key_name):
        raise ProtocolError("unknown_key", f"Key '{key_name}' is not available.")
    if agent is not None and agent.allowed_keys and key_name not in agent.allowed_keys:
        raise ProtocolError("unknown_key", f"Key '{key_name}' is not available.")
    if secret_store.get(db, principal.tenant_id, key_name) is None:
        raise ProtocolError("unknown_key", f"Key '{key_name}' is not configured.")

    # ── Policy ─────────────────────────────────────────────────────────────────
    ihash = req_service.intent_hash(body.agent_id, key_name, body.intent)
    decision = get_policy_engine().evaluate(
        PolicyContext(
            tenant_id=principal.tenant_id,
            agent_id=body.agent_id,
            key_name=key_name,
            intent=body.intent,
            intent_hash=ihash,
            policy_hint=body.policy_hint,
            agent_default_policy=agent.default_policy if agent else None,
            secret_default_policy=(
                s.default_policy if (s := secret_store.get(db, principal.tenant_id, key_name)) else None
            ),
            agent_require_approval=agent.require_approval if agent else True,
            has_standing_approval=req_service.has_standing_approval(
                db, principal.tenant_id, body.agent_id, key_name, ihash
            ),
        )
    )

    req = req_service.create_request(
        db,
        tenant_id=principal.tenant_id,
        api_key_id=principal.api_key_id,
        key_name=key_name,
        intent=body.intent,
        agent_id=body.agent_id,
        session_id=body.session_id,
        nonce=body.nonce,
        ip_address=request.client.host if request.client else "",
        effective_policy=decision.effective_policy,
    )

    if decision.action == "deny":
        # Return the protocol denied body (status=denied) so the audit row
        # persists and SDKs surface AccessDeniedError consistently.
        return req_service.deny(
            db, req, reason=decision.reason or "policy denied", decision_by="policy"
        )

    if decision.action == "auto_approve":
        return req_service.approve(db, req, decision_by="auto")

    # require_human → pending; notify the owner out-of-band.
    notification = Notification(
        token=req.token,
        key_name=key_name,
        agent_id=body.agent_id,
        intent=body.intent,
        approve_url=f"{settings.public_url.rstrip('/')}/dashboard",
        dashboard_url=f"{settings.public_url.rstrip('/')}/dashboard",
    )
    try:
        get_notifier().notify_pending(notification)
    except Exception:  # pragma: no cover - notifier is best-effort
        pass
    return req_service.pending_response(req)


@router.get("/pending/{token}")
def poll(token: str, db: DbSession) -> Any:
    req = req_service.get_request(db, token)
    if req is None:
        raise ProtocolError("expired_token", "Unknown or expired token.")
    if req_service.expire_if_due(db, req):
        raise ProtocolError("expired_token", "Pending request expired.")

    if req.status == "pending":
        return req_service.pending_response(req)
    if req.status == "approved":
        secret_row = secret_store.get(db, req.tenant_id, req.key_name)
        return {
            "status": "approved",
            "token": req.token,
            "secret": secret_store.reveal(secret_row) if secret_row else "",
            "decision_by": req.decision_by or "owner",
            "decided_at": to_iso(req.decided_at) if req.decided_at else "",
            "audit_id": req.audit_id or "",
            "effective_policy": req.effective_policy,
        }
    if req.status == "denied":
        return {
            "status": "denied",
            "token": req.token,
            "reason": req.reason or "",
            "decided_at": to_iso(req.decided_at) if req.decided_at else "",
            "audit_id": req.audit_id or "",
            "effective_policy": req.effective_policy,
        }
    raise ProtocolError("expired_token", "Pending request expired.")


@router.post("/decisions/{token}")
def decide(token: str, body: DecisionBody, principal: CurrentPrincipal, db: DbSession) -> Any:
    require_admin(principal)
    req = req_service.get_request(db, token, tenant_id=principal.tenant_id)
    if req is None:
        raise ProtocolError("expired_token", "Unknown token.")
    if req.status in ("approved", "denied"):
        raise ProtocolError("invalid_intent", f"Request already {req.status}.")
    if req_service.expire_if_due(db, req):
        raise ProtocolError("expired_token", "Pending request expired.")

    if body.decision == "approve":
        return req_service.approve(db, req, decision_by="owner")
    return req_service.deny(db, req, reason=body.reason or "denied", decision_by="owner")


@router.get("/audit")
def audit(principal: CurrentPrincipal, db: DbSession, limit: int = 50) -> Any:
    limit = max(1, min(500, limit))
    rows = db.scalars(
        select(RequestRow)
        .where(RequestRow.tenant_id == principal.tenant_id)
        .order_by(RequestRow.requested_at.desc())
        .limit(limit)
    )
    records = [
        {
            "audit_id": r.audit_id or "",
            "agent_id": r.agent_id,
            "session_id": r.session_id,
            "key_name": r.key_name,
            "intent": r.intent,
            "decision": r.status,
            "decided_by": r.decision_by or "",
            "requested_at": to_iso(r.requested_at),
            "decided_at": to_iso(r.decided_at) if r.decided_at else "",
            "ip_address": r.ip_address or "",
            "nonce": r.nonce,
        }
        for r in rows
    ]
    return {"records": records}
