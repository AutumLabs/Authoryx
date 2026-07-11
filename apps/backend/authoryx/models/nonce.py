"""Nonce — replay-protection ledger, keyed per API key.

A unique constraint on (api_key_hash, nonce) makes replays an insert
failure. Rows older than the retention window may be pruned.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from ..core.db import Base
from .base_columns import created_at_column, id_column


class Nonce(Base):
    __tablename__ = "nonces"
    __table_args__ = (
        UniqueConstraint("api_key_hash", "nonce", name="uq_nonce_apikey_nonce"),
    )

    id: Mapped[str] = id_column()
    api_key_hash: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    nonce: Mapped[str] = mapped_column(String(64), nullable=False)
    seen_at: Mapped[datetime] = created_at_column()
