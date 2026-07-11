"""Shared FastAPI dependencies."""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, Header
from sqlalchemy.orm import Session

from ..core.db import get_session
from ..core.security import parse_bearer
from ..services.principal import Principal, authenticate

DbSession = Annotated[Session, Depends(get_session)]


def get_principal(
    db: DbSession,
    authorization: Annotated[str | None, Header()] = None,
) -> Principal:
    """Authenticate from the Authorization header (admin/audit endpoints)."""
    return authenticate(db, parse_bearer(authorization))


CurrentPrincipal = Annotated[Principal, Depends(get_principal)]
