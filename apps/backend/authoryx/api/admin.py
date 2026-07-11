"""Admin management plane: /v1/admin/* (additive within v1).

All endpoints require an admin-scoped API key. Secret *values* are never
returned by any endpoint here — they leave the backend only through the
approved agent-fetch flow.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter
from sqlalchemy import select

from ..core.clock import to_iso
from ..core.security import KEY_NAME_RE, generate_api_key, hash_api_key, key_last4, key_prefix
from ..models import Agent, ApiKey, Secret
from ..services import secret_store
from ..services.principal import require_admin
from .deps import CurrentPrincipal, DbSession
from .errors import ProtocolError
from .schemas import AgentRegister, ApiKeyIssue, SecretUpsert

router = APIRouter(prefix="/v1/admin", tags=["admin"])


# ── Secrets ────────────────────────────────────────────────────────────────────

@router.post("/keys", status_code=201)
def upsert_secret(body: SecretUpsert, principal: CurrentPrincipal, db: DbSession) -> Any:
    require_admin(principal)
    if not KEY_NAME_RE.match(body.key_name):
        raise ProtocolError("invalid_intent", "key_name must be SCREAMING_SNAKE_CASE.")
    secret_store.upsert(
        db,
        tenant_id=principal.tenant_id,
        key_name=body.key_name,
        value=body.value,
        description=body.description,
        default_policy=body.default_policy,
        source=body.source,
    )
    return {"key_name": body.key_name, "status": "stored"}


@router.get("/keys")
def list_secrets(principal: CurrentPrincipal, db: DbSession) -> Any:
    require_admin(principal)
    rows = secret_store.list_names(db, principal.tenant_id)
    return {
        "keys": [
            {
                "key_name": r.key_name,
                "description": r.description,
                "default_policy": r.default_policy,
                "source": r.source,
                "updated_at": to_iso(r.updated_at),
            }
            for r in rows
        ]
    }


@router.delete("/keys/{key_name}", status_code=204)
def delete_secret(key_name: str, principal: CurrentPrincipal, db: DbSession) -> None:
    require_admin(principal)
    if not secret_store.delete(db, principal.tenant_id, key_name):
        raise ProtocolError("unknown_key", f"Key '{key_name}' not found.")


# ── Agents ─────────────────────────────────────────────────────────────────────

@router.post("/agents", status_code=201)
def register_agent(body: AgentRegister, principal: CurrentPrincipal, db: DbSession) -> Any:
    require_admin(principal)
    agent = Agent(
        tenant_id=principal.tenant_id,
        external_id=body.external_id,
        name=body.name,
        description=body.description,
        allowed_keys=body.allowed_keys,
        require_approval=body.require_approval,
        default_policy=body.default_policy,
    )
    db.add(agent)
    db.flush()
    return {"id": agent.id, "name": agent.name, "external_id": agent.external_id}


@router.get("/agents")
def list_agents(principal: CurrentPrincipal, db: DbSession) -> Any:
    require_admin(principal)
    rows = db.scalars(select(Agent).where(Agent.tenant_id == principal.tenant_id))
    return {
        "agents": [
            {
                "id": a.id,
                "name": a.name,
                "external_id": a.external_id,
                "description": a.description,
                "allowed_keys": a.allowed_keys,
                "require_approval": a.require_approval,
                "default_policy": a.default_policy,
            }
            for a in rows
        ]
    }


# ── API keys ───────────────────────────────────────────────────────────────────

@router.post("/api-keys", status_code=201)
def issue_api_key(body: ApiKeyIssue, principal: CurrentPrincipal, db: DbSession) -> Any:
    require_admin(principal)
    plaintext = generate_api_key()
    row = ApiKey(
        tenant_id=principal.tenant_id,
        key_hash=hash_api_key(plaintext),
        prefix=key_prefix(plaintext),
        last4=key_last4(plaintext),
        label=body.label,
        scope=body.scope,
        allowed_keys=body.allowed_keys,
    )
    db.add(row)
    db.flush()
    # Plaintext is returned exactly once, here, and never stored.
    return {
        "id": row.id,
        "api_key": plaintext,
        "prefix": row.prefix,
        "last4": row.last4,
        "label": row.label,
        "scope": row.scope,
        "allowed_keys": row.allowed_keys,
        "created_at": to_iso(row.created_at),
    }


@router.get("/api-keys")
def list_api_keys(principal: CurrentPrincipal, db: DbSession) -> Any:
    require_admin(principal)
    rows = db.scalars(select(ApiKey).where(ApiKey.tenant_id == principal.tenant_id))
    return {
        "api_keys": [
            {
                "id": k.id,
                "prefix": k.prefix,
                "last4": k.last4,
                "label": k.label,
                "scope": k.scope,
                "allowed_keys": k.allowed_keys,
                "created_at": to_iso(k.created_at),
                "revoked_at": to_iso(k.revoked_at) if k.revoked_at else None,
            }
            for k in rows
        ]
    }


@router.post("/api-keys/{key_id}/revoke")
def revoke_api_key(key_id: str, principal: CurrentPrincipal, db: DbSession) -> Any:
    require_admin(principal)
    from ..core.clock import now

    row = db.scalar(
        select(ApiKey).where(ApiKey.id == key_id, ApiKey.tenant_id == principal.tenant_id)
    )
    if row is None:
        raise ProtocolError("unknown_key", "API key not found.")
    if row.revoked_at is None:
        row.revoked_at = now()
        db.flush()
    return {"id": row.id, "revoked": True}
