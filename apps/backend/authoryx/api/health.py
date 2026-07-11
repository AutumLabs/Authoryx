"""Liveness/readiness probe."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter
from sqlalchemy import text

from .. import __version__
from ..core.config import settings
from .deps import DbSession

router = APIRouter(tags=["health"])


@router.get("/health")
def health(db: DbSession) -> Any:
    db.execute(text("SELECT 1"))
    return {"status": "ok", "version": __version__, "env": settings.env}
