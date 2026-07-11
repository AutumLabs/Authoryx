"""Request — the lifecycle state of one intent/fetch.

This is the live state machine (pending → approved | denied | expired) and
also the source the agent-facing ``GET /v1/os/audit`` reads from. The
append-only :class:`~authoryx.models.audit.AuditLog` records each transition
immutably for forensics.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from ..core.db import Base
from .base_columns import created_at_column


class Request(Base):
    __tablename__ = "requests"

    token: Mapped[str] = mapped_column(String(64), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"), index=True, nullable=False
    )
    api_key_id: Mapped[str] = mapped_column(String(32), index=True, nullable=False)

    key_name: Mapped[str] = mapped_column(String(128), nullable=False)
    intent: Mapped[str] = mapped_column(Text, nullable=False)
    intent_hash: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    agent_id: Mapped[str] = mapped_column(String(128), nullable=False)
    session_id: Mapped[str] = mapped_column(String(128), nullable=False)
    nonce: Mapped[str] = mapped_column(String(64), nullable=False)

    status: Mapped[str] = mapped_column(String(16), default="pending", index=True, nullable=False)
    effective_policy: Mapped[str] = mapped_column(String(24), default="require_approval")
    decision_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(nullable=True)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    audit_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    ip_address: Mapped[str] = mapped_column(String(64), default="")

    requested_at: Mapped[datetime] = created_at_column()
    expires_at: Mapped[datetime] = mapped_column(nullable=False)
