"""Replay-protection ledger."""

from __future__ import annotations

from datetime import datetime, timezone

from .db import connect


def record_or_reject(api_key: str, nonce: str) -> bool:
    """Return True if the nonce was newly recorded; False if it was a replay."""
    now = datetime.now(timezone.utc).isoformat()
    with connect() as conn:
        try:
            conn.execute(
                "INSERT INTO nonces (api_key, nonce, seen_at) VALUES (?, ?, ?)",
                (api_key, nonce, now),
            )
        except Exception:
            return False
    return True
