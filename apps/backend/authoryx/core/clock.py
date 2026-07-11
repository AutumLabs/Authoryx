"""Time helpers — a single source of truth for UTC and RFC 3339 formatting.

The protocol uses RFC 3339 / ISO 8601 timestamps in UTC with a trailing
``Z``. Centralizing this avoids the subtle ``+00:00`` vs ``Z`` mismatches
that break clients.
"""

from __future__ import annotations

from datetime import datetime, timezone


def now() -> datetime:
    """Current time, timezone-aware, in UTC."""
    return datetime.now(timezone.utc)


def ensure_aware(dt: datetime) -> datetime:
    """Attach UTC to a naive datetime.

    Backends like SQLite drop tzinfo on round-trip; stored timestamps are
    always UTC by construction, so a naive value is interpreted as UTC.
    """
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


def to_iso(dt: datetime) -> str:
    """Format a datetime as RFC 3339 UTC with a trailing ``Z``."""
    return ensure_aware(dt).astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def parse_iso(value: str) -> datetime:
    """Parse an RFC 3339 timestamp (accepting a trailing ``Z``)."""
    return datetime.fromisoformat(value.replace("Z", "+00:00"))
