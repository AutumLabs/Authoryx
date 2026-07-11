"""Secret — an encrypted-at-rest credential, addressed by ``key_name``.

Only the four envelope-encryption components are persisted; the plaintext
is reconstructed transiently (see ``core.crypto.open_secret``) only when
serving an approved fetch.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from ..core.db import Base
from .base_columns import created_at_column, id_column


class Secret(Base):
    __tablename__ = "secrets"
    __table_args__ = (UniqueConstraint("tenant_id", "key_name", name="uq_secret_tenant_key"),)

    id: Mapped[str] = id_column()
    tenant_id: Mapped[str] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"), index=True, nullable=False
    )
    key_name: Mapped[str] = mapped_column(String(128), nullable=False)

    # Envelope ciphertext components (base64). Never plaintext.
    ciphertext: Mapped[str] = mapped_column(Text, nullable=False)
    nonce: Mapped[str] = mapped_column(Text, nullable=False)
    wrapped_dek: Mapped[str] = mapped_column(Text, nullable=False)
    dek_nonce: Mapped[str] = mapped_column(Text, nullable=False)

    description: Mapped[str] = mapped_column(String(512), default="")
    default_policy: Mapped[str | None] = mapped_column(String(24), nullable=True)
    source: Mapped[str] = mapped_column(String(512), default="")

    created_at: Mapped[datetime] = created_at_column()
    updated_at: Mapped[datetime] = created_at_column()
