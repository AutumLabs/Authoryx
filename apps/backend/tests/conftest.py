"""Test fixtures. Environment is configured BEFORE importing the app so the
settings singleton picks up the test database and a deterministic master key.
"""

from __future__ import annotations

import os
import tempfile

_TMP = tempfile.mkdtemp(prefix="authoryx-test-")
os.environ.setdefault("AUTHORYX_ENV", "test")
os.environ.setdefault("AUTHORYX_DATABASE_URL", f"sqlite:///{_TMP}/test.db")
os.environ.setdefault("AUTHORYX_MASTER_KEY", "11" * 32)  # 32 bytes hex
os.environ.setdefault("AUTHORYX_SESSION_SECRET", "test-session-secret")
os.environ.setdefault("AUTHORYX_OWNER_PASSWORD", "test-owner")
os.environ.setdefault("AUTHORYX_AUTO_APPROVE", "false")

import pytest
from fastapi.testclient import TestClient

from authoryx.core.db import SessionLocal, create_all
from authoryx.main import app
from authoryx.services.seed import seed


@pytest.fixture(scope="session", autouse=True)
def _db() -> None:
    create_all()


@pytest.fixture(scope="session")
def admin_key() -> str:
    db = SessionLocal()
    try:
        result = seed(db, mint_admin_key=True, demo_secret=True)
    finally:
        db.close()
    assert result.admin_api_key
    return result.admin_api_key


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)
