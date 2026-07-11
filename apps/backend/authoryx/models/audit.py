"""AuditLog — append-only forensic record of every decision event.

Rows are never updated or deleted by the application. Each state transition
of a request (created, approved, denied, expired) appends one row.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from ..core.db import Base
from .base_columns import created_at_column, id_column


class AuditLog(Base):
    __tablename__ = "audit_log"

    id: Mapped[str] = id_column()
    tenant_id: Mapped[str] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"), index=True, nullable=False
    )
    event: Mapped[str] = mapped_column(String(48), index=True, nullable=False)
    token: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    agent_id: Mapped[str] = mapped_column(String(128), default="")
    key_name: Mapped[str] = mapped_column(String(128), default="")
    decision: Mapped[str] = mapped_column(String(16), default="")
    decided_by: Mapped[str] = mapped_column(String(64), default="")
    intent: Mapped[str] = mapped_column(Text, default="")
    ip_address: Mapped[str] = mapped_column(String(64), default="")
    created_at: Mapped[datetime] = created_at_column()
