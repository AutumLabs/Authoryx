"""ApiKey — a hashed credential scoped to a tenant.

Scope is either ``agent`` (fetch only) or ``admin`` (fetch + management
plane). ``allowed_keys`` optionally restricts which secret names this key
may fetch; an empty list means "all keys in the tenant".
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import JSON

from ..core.db import Base
from .base_columns import created_at_column, id_column


class ApiKey(Base):
    __tablename__ = "api_keys"

    id: Mapped[str] = id_column()
    tenant_id: Mapped[str] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"), index=True, nullable=False
    )
    key_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    prefix: Mapped[str] = mapped_column(String(32), nullable=False)
    last4: Mapped[str] = mapped_column(String(8), nullable=False)
    label: Mapped[str] = mapped_column(String(128), default="")
    scope: Mapped[str] = mapped_column(String(16), default="agent", nullable=False)
    allowed_keys: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    created_at: Mapped[datetime] = created_at_column()
    revoked_at: Mapped[datetime | None] = mapped_column(nullable=True)

    @property
    def is_active(self) -> bool:
        return self.revoked_at is None

    def may_fetch(self, key_name: str) -> bool:
        return not self.allowed_keys or key_name in self.allowed_keys
