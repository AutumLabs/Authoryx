"""SQLAlchemy engine, session factory, and declarative base.

Synchronous SQLAlchemy is used deliberately: it works identically on SQLite
(dev) and Postgres (prod) with no async-driver juggling, and FastAPI runs
plain ``def`` route handlers in a threadpool so request handling stays
non-blocking. Swap engines purely by ``AUTHORYX_DATABASE_URL``.
"""

from __future__ import annotations

from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import settings


class Base(DeclarativeBase):
    pass


def _engine_kwargs(url: str) -> dict:
    if url.startswith("sqlite"):
        # check_same_thread=False is needed because FastAPI's threadpool may
        # touch a connection from a different thread than it was created on.
        return {"connect_args": {"check_same_thread": False}}
    return {"pool_pre_ping": True}


engine = create_engine(settings.database_url, **_engine_kwargs(settings.database_url))
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_session() -> Iterator[Session]:
    """FastAPI dependency: a request-scoped session.

    Commits on a clean return, rolls back on any exception, always closes.
    """
    session = SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def create_all() -> None:
    """Create tables directly (used in dev/test and by the conformance suite).

    Production uses Alembic migrations instead.
    """
    # Import models so they register on Base.metadata before create_all.
    from .. import models  # noqa: F401

    Base.metadata.create_all(bind=engine)
