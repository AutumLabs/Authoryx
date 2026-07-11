"""Resolve a bearer API key into an authenticated principal."""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..api.errors import ProtocolError
from ..core.security import API_KEY_RE, hash_api_key
from ..models import ApiKey


@dataclass(frozen=True)
class Principal:
    tenant_id: str
    api_key_id: str
    api_key_hash: str
    scope: str  # "agent" | "admin"
    allowed_keys: list[str]

    @property
    def is_admin(self) -> bool:
        return self.scope == "admin"

    def may_fetch(self, key_name: str) -> bool:
        return not self.allowed_keys or key_name in self.allowed_keys


def authenticate(db: Session, api_key: str | None) -> Principal:
    """Validate the key format and look it up by hash. Raises on failure."""
    if not api_key or not API_KEY_RE.match(api_key):
        raise ProtocolError("invalid_api_key", "API key missing or malformed.")

    row = db.scalar(select(ApiKey).where(ApiKey.key_hash == hash_api_key(api_key)))
    if row is None or not row.is_active:
        raise ProtocolError("invalid_api_key", "API key is unknown or revoked.")

    return Principal(
        tenant_id=row.tenant_id,
        api_key_id=row.id,
        api_key_hash=row.key_hash,
        scope=row.scope,
        allowed_keys=list(row.allowed_keys or []),
    )


def require_admin(principal: Principal) -> None:
    if not principal.is_admin:
        raise ProtocolError("forbidden", "This API key lacks admin scope.")
