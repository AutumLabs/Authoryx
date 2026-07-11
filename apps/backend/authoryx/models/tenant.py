"""Tenant — the top-level isolation boundary.

Every API key, agent, secret, request, and audit row belongs to exactly one
tenant. A single-tenant self-host simply has one row here.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column

from ..core.db import Base
from .base_columns import created_at_column, id_column


class Tenant(Base):
    __tablename__ = "tenants"

    id: Mapped[str] = id_column()
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    created_at: Mapped[datetime] = created_at_column()
