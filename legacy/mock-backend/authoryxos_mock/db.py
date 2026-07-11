"""SQLite storage for the mock backend.

Stores intent requests, nonces (for replay detection), and audit records.
Never stores the secret value — secrets live in the `.env` file loaded
by `secrets.py`.
"""

from __future__ import annotations

import os
import sqlite3
import threading
from contextlib import contextmanager
from typing import Iterator

_SCHEMA = """
CREATE TABLE IF NOT EXISTS requests (
    token          TEXT PRIMARY KEY,
    api_key        TEXT NOT NULL,
    key_name       TEXT NOT NULL,
    intent         TEXT NOT NULL,
    agent_id       TEXT NOT NULL,
    session_id     TEXT NOT NULL,
    nonce          TEXT NOT NULL,
    requested_at   TEXT NOT NULL,
    expires_at     TEXT NOT NULL,
    status         TEXT NOT NULL,  -- pending | approved | denied | expired
    decision_by    TEXT,
    decided_at     TEXT,
    reason         TEXT,
    audit_id       TEXT,
    ip_address     TEXT
);
CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(status);

CREATE TABLE IF NOT EXISTS nonces (
    api_key TEXT NOT NULL,
    nonce   TEXT NOT NULL,
    seen_at TEXT NOT NULL,
    PRIMARY KEY (api_key, nonce)
);
"""

_lock = threading.Lock()


def db_path() -> str:
    return os.environ.get("MOCK_DB_PATH", "./authoryxos.db")


@contextmanager
def connect() -> Iterator[sqlite3.Connection]:
    """Open a short-lived connection. Serialized by a process-wide lock —
    the mock backend is single-tenant local-dev only."""
    with _lock:
        conn = sqlite3.connect(db_path())
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()


def init_db() -> None:
    with connect() as conn:
        conn.executescript(_SCHEMA)
