"""Encrypted secret storage — the only place plaintext is sealed/opened."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..core import crypto
from ..core.clock import now
from ..models import Secret


def upsert(
    db: Session,
    *,
    tenant_id: str,
    key_name: str,
    value: str,
    description: str = "",
    default_policy: str | None = None,
    source: str = "",
) -> Secret:
    """Create or replace a secret, encrypting the value at rest."""
    sealed = crypto.seal(value)
    row = db.scalar(
        select(Secret).where(Secret.tenant_id == tenant_id, Secret.key_name == key_name)
    )
    if row is None:
        row = Secret(tenant_id=tenant_id, key_name=key_name)
        db.add(row)
    row.ciphertext = sealed.ciphertext
    row.nonce = sealed.nonce
    row.wrapped_dek = sealed.wrapped_dek
    row.dek_nonce = sealed.dek_nonce
    row.description = description
    row.default_policy = default_policy
    row.source = source
    row.updated_at = now()
    db.flush()
    return row


def get(db: Session, tenant_id: str, key_name: str) -> Secret | None:
    return db.scalar(
        select(Secret).where(Secret.tenant_id == tenant_id, Secret.key_name == key_name)
    )


def reveal(secret: Secret) -> str:
    """Decrypt a stored secret to plaintext. Caller must not log the result."""
    return crypto.open_secret(
        crypto.SealedSecret(
            ciphertext=secret.ciphertext,
            nonce=secret.nonce,
            wrapped_dek=secret.wrapped_dek,
            dek_nonce=secret.dek_nonce,
        )
    )


def list_names(db: Session, tenant_id: str) -> list[Secret]:
    return list(
        db.scalars(
            select(Secret).where(Secret.tenant_id == tenant_id).order_by(Secret.key_name)
        )
    )


def delete(db: Session, tenant_id: str, key_name: str) -> bool:
    row = get(db, tenant_id, key_name)
    if row is None:
        return False
    db.delete(row)
    db.flush()
    return True
