"""Local pause/resume store. Survives process restarts.

The pause store NEVER contains the secret value. It only holds the
information needed to re-attach to a pending request:
token, poll URL, the key name, the agent and session IDs, expiry, and
the base URL of the backend.
"""

from __future__ import annotations

import os
import sqlite3
from dataclasses import dataclass
from pathlib import Path

_SCHEMA = """
CREATE TABLE IF NOT EXISTS pending (
    token        TEXT PRIMARY KEY,
    base_url     TEXT NOT NULL,
    poll_url     TEXT NOT NULL,
    poll_interval INTEGER NOT NULL,
    expires_at   TEXT NOT NULL,
    key_name     TEXT NOT NULL,
    agent_id     TEXT NOT NULL,
    session_id   TEXT NOT NULL,
    created_at   TEXT NOT NULL
);
"""


def default_path() -> Path:
    override = os.environ.get("AUTHORYXOS_PAUSE_DB")
    if override:
        return Path(override)
    root = Path(os.path.expanduser("~")) / ".authoryxos"
    root.mkdir(parents=True, exist_ok=True)
    return root / "pause.db"


@dataclass
class PendingRow:
    token: str
    base_url: str
    poll_url: str
    poll_interval: int
    expires_at: str
    key_name: str
    agent_id: str
    session_id: str
    created_at: str


class PauseStore:
    def __init__(self, path: Path | None = None) -> None:
        self.path = path or default_path()
        with self._conn() as c:
            c.executescript(_SCHEMA)

    def _conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.path)
        conn.row_factory = sqlite3.Row
        return conn

    def save(self, row: PendingRow) -> None:
        with self._conn() as c:
            c.execute(
                """INSERT OR REPLACE INTO pending
                   (token, base_url, poll_url, poll_interval, expires_at,
                    key_name, agent_id, session_id, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (row.token, row.base_url, row.poll_url, row.poll_interval,
                 row.expires_at, row.key_name, row.agent_id, row.session_id,
                 row.created_at),
            )
            c.commit()

    def delete(self, token: str) -> None:
        with self._conn() as c:
            c.execute("DELETE FROM pending WHERE token = ?", (token,))
            c.commit()

    def all(self) -> list[PendingRow]:
        with self._conn() as c:
            rows = c.execute("SELECT * FROM pending").fetchall()
        return [PendingRow(**dict(r)) for r in rows]

    def get(self, token: str) -> PendingRow | None:
        with self._conn() as c:
            r = c.execute(
                "SELECT * FROM pending WHERE token = ?", (token,)
            ).fetchone()
        return PendingRow(**dict(r)) if r else None
