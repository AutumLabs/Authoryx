"""API-key generation, hashing, and bearer-token parsing.

Keys are of the form ``axos_live_<random>``. Only a SHA-256 hash is stored;
the plaintext is shown exactly once at issuance. Lookups are by hash, in
constant time per row via the unique index.
"""

from __future__ import annotations

import hashlib
import hmac
import re
import secrets

API_KEY_RE = re.compile(r"^axos_live_[A-Za-z0-9]{20,}$")
KEY_NAME_RE = re.compile(r"^[A-Z][A-Z0-9_]{0,127}$")
NONCE_RE = re.compile(r"^[0-9a-f]{24}$")

_PREFIX = "axos_live_"


def generate_api_key() -> str:
    """Mint a new plaintext API key. Store only :func:`hash_api_key` of it."""
    return _PREFIX + secrets.token_hex(24)  # 48 hex chars after the prefix


def hash_api_key(api_key: str) -> str:
    """Stable SHA-256 hex digest used as the stored lookup key."""
    return hashlib.sha256(api_key.encode("utf-8")).hexdigest()


def key_prefix(api_key: str) -> str:
    """Short non-secret prefix shown in listings, e.g. ``axos_live_ab12``."""
    return api_key[: len(_PREFIX) + 4]


def key_last4(api_key: str) -> str:
    return api_key[-4:]


def parse_bearer(authorization: str | None, body_key: str | None = None) -> str | None:
    """Extract the API key from an ``Authorization: Bearer`` header.

    Falls back to ``body_key`` (the ``api_key`` field) for protocol clients
    that send it in the body as well.
    """
    if authorization and authorization.lower().startswith("bearer "):
        return authorization[7:].strip()
    return body_key or None


def constant_time_equals(a: str, b: str) -> bool:
    return hmac.compare_digest(a, b)
