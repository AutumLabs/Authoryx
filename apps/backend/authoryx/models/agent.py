"""Agent — a registered automation with a scope and default approval policy."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import JSON

from ..core.db import Base
from .base_columns import created_at_column, id_column


class Agent(Base):
    __tablename__ = "agents"

    id: Mapped[str] = id_column()
    tenant_id: Mapped[str] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"), index=True, nullable=False
    )
    # The opaque agent_id the SDK sends in intent requests. Optional link.
    external_id: Mapped[str | None] = mapped_column(String(128), index=True, nullable=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    description: Mapped[str] = mapped_column(String(512), default="")
    allowed_keys: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    require_approval: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    default_policy: Mapped[str] = mapped_column(
        String(24), default="require_approval", nullable=False
    )
    created_at: Mapped[datetime] = created_at_column()
