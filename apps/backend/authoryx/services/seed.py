"""Idempotent bootstrap seed: a default tenant, an admin API key, a demo secret.

Used by ``authoryx-backend seed`` (and the bootstrap script) so a fresh
install is immediately usable. Safe to run repeatedly: it reuses the
existing default tenant and only mints a new admin key on request.
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..core.security import generate_api_key, hash_api_key, key_last4, key_prefix
from ..models import ApiKey, Tenant
from . import secret_store


@dataclass
class SeedResult:
    tenant_id: str
    admin_api_key: str | None  # plaintext, only when a new key was minted


def ensure_default_tenant(db: Session, name: str = "default") -> Tenant:
    tenant = db.scalar(select(Tenant).order_by(Tenant.created_at).limit(1))
    if tenant is None:
        tenant = Tenant(name=name)
        db.add(tenant)
        db.flush()
    return tenant


def seed(db: Session, *, mint_admin_key: bool = True, demo_secret: bool = True) -> SeedResult:
    tenant = ensure_default_tenant(db)

    admin_plaintext: str | None = None
    if mint_admin_key:
        admin_plaintext = generate_api_key()
        db.add(
            ApiKey(
                tenant_id=tenant.id,
                key_hash=hash_api_key(admin_plaintext),
                prefix=key_prefix(admin_plaintext),
                last4=key_last4(admin_plaintext),
                label="bootstrap-admin",
                scope="admin",
                allowed_keys=[],
            )
        )

    if demo_secret and secret_store.get(db, tenant.id, "TEST_KEY") is None:
        secret_store.upsert(
            db,
            tenant_id=tenant.id,
            key_name="TEST_KEY",
            value="hello-from-authoryxos",
            description="Demo secret created by seed.",
            source="seed",
        )

    db.commit()
    return SeedResult(tenant_id=tenant.id, admin_api_key=admin_plaintext)
