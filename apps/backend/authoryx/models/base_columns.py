"""Shared column helpers for models."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime
from sqlalchemy.orm import Mapped, mapped_column

from ..core.clock import now


def new_id() -> str:
    return uuid.uuid4().hex


def id_column() -> Mapped[str]:
    return mapped_column(primary_key=True, default=new_id)


def created_at_column() -> Mapped[datetime]:
    return mapped_column(DateTime(timezone=True), default=now, nullable=False)
