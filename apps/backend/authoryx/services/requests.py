"""Request lifecycle: create → (auto|human) → approved | denied | expired.

This module owns the state machine, the append-only audit trail, and the
standing-approval bookkeeping. It never logs secret values; the plaintext
is read only at the moment of building an approved response.
"""

from __future__ import annotations

import hashlib
import secrets as _secrets
from datetime import timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..core.clock import ensure_aware, now, to_iso
from ..core.config import settings
from ..models import AuditLog, Nonce, Request, StandingApproval
from . import secret_store


def intent_hash(agent_id: str, key_name: str, intent: str) -> str:
    return hashlib.sha256(f"{agent_id}\x1f{key_name}\x1f{intent}".encode()).hexdigest()


def new_token() -> str:
    return f"pending_{_secrets.token_urlsafe(18)}"


def new_audit_id() -> str:
    return f"audit_{_secrets.token_urlsafe(12)}"


def record_nonce(db: Session, api_key_hash: str, nonce: str) -> bool:
    """Insert the nonce; return False if it was already seen (a replay)."""
    db.add(Nonce(api_key_hash=api_key_hash, nonce=nonce))
    try:
        db.flush()
    except Exception:
        db.rollback()
        return False
    return True


def has_standing_approval(
    db: Session, tenant_id: str, agent_id: str, key_name: str, ihash: str
) -> bool:
    return db.scalar(
        select(StandingApproval.id).where(
            StandingApproval.tenant_id == tenant_id,
            StandingApproval.agent_id == agent_id,
            StandingApproval.key_name == key_name,
            StandingApproval.intent_hash == ihash,
        )
    ) is not None


def _audit(db: Session, req: Request, event: str, decision: str) -> None:
    db.add(
        AuditLog(
            tenant_id=req.tenant_id,
            event=event,
            token=req.token,
            agent_id=req.agent_id,
            key_name=req.key_name,
            decision=decision,
            decided_by=req.decision_by or "",
            intent=req.intent,
            ip_address=req.ip_address,
        )
    )


def create_request(
    db: Session,
    *,
    tenant_id: str,
    api_key_id: str,
    key_name: str,
    intent: str,
    agent_id: str,
    session_id: str,
    nonce: str,
    ip_address: str,
    effective_policy: str,
) -> Request:
    ts = now()
    req = Request(
        token=new_token(),
        tenant_id=tenant_id,
        api_key_id=api_key_id,
        key_name=key_name,
        intent=intent,
        intent_hash=intent_hash(agent_id, key_name, intent),
        agent_id=agent_id,
        session_id=session_id,
        nonce=nonce,
        status="pending",
        effective_policy=effective_policy,
        ip_address=ip_address,
        requested_at=ts,
        expires_at=ts + timedelta(seconds=settings.pending_ttl_seconds),
    )
    db.add(req)
    _audit(db, req, "request.created", "pending")
    db.flush()
    return req


def get_request(db: Session, token: str, tenant_id: str | None = None) -> Request | None:
    stmt = select(Request).where(Request.token == token)
    if tenant_id is not None:
        stmt = stmt.where(Request.tenant_id == tenant_id)
    return db.scalar(stmt)


def pending_response(req: Request) -> dict[str, Any]:
    return {
        "status": "pending",
        "token": req.token,
        "poll_url": f"/v1/os/pending/{req.token}",
        "poll_interval_seconds": settings.poll_interval_seconds,
        "expires_at": to_iso(req.expires_at),
        "effective_policy": req.effective_policy,
    }


def approve(db: Session, req: Request, *, decision_by: str) -> dict[str, Any]:
    """Transition to approved, record audit + standing grant, return the secret."""
    secret_row = secret_store.get(db, req.tenant_id, req.key_name)
    plaintext = secret_store.reveal(secret_row) if secret_row else ""

    req.status = "approved"
    req.decision_by = decision_by
    req.decided_at = now()
    req.audit_id = new_audit_id()
    _audit(db, req, "request.approved", "approved")

    if req.effective_policy == "always_approve" and not has_standing_approval(
        db, req.tenant_id, req.agent_id, req.key_name, req.intent_hash
    ):
        db.add(
            StandingApproval(
                tenant_id=req.tenant_id,
                agent_id=req.agent_id,
                key_name=req.key_name,
                intent_hash=req.intent_hash,
            )
        )
    db.flush()

    return {
        "status": "approved",
        "token": req.token,
        "secret": plaintext,
        "decision_by": decision_by,
        "decided_at": to_iso(req.decided_at),
        "audit_id": req.audit_id,
        "effective_policy": req.effective_policy,
    }


def deny(db: Session, req: Request, *, reason: str, decision_by: str) -> dict[str, Any]:
    req.status = "denied"
    req.decision_by = decision_by
    req.decided_at = now()
    req.reason = reason
    req.audit_id = new_audit_id()
    _audit(db, req, "request.denied", "denied")
    db.flush()
    return {
        "status": "denied",
        "token": req.token,
        "reason": reason,
        "decided_at": to_iso(req.decided_at),
        "audit_id": req.audit_id,
        "effective_policy": req.effective_policy,
    }


def expire_if_due(db: Session, req: Request) -> bool:
    """Mark a still-pending, past-deadline request expired. Returns True if so."""
    if req.status == "pending" and now() > ensure_aware(req.expires_at):
        req.status = "expired"
        _audit(db, req, "request.expired", "expired")
        db.flush()
        return True
    return False
