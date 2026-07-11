"""StandingApproval — a remembered ``always_approve`` grant.

When an owner approves a request whose effective policy is ``always_approve``,
a row is recorded for ``(agent_id, key_name, intent_hash)``. Future requests
matching it auto-approve without a fresh human decision.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from ..core.db import Base
from .base_columns import created_at_column, id_column


class StandingApproval(Base):
    __tablename__ = "standing_approvals"
    __table_args__ = (
        UniqueConstraint(
            "tenant_id", "agent_id", "key_name", "intent_hash",
            name="uq_standing_approval",
        ),
    )

    id: Mapped[str] = id_column()
    tenant_id: Mapped[str] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"), index=True, nullable=False
    )
    agent_id: Mapped[str] = mapped_column(String(128), nullable=False)
    key_name: Mapped[str] = mapped_column(String(128), nullable=False)
    intent_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = created_at_column()
