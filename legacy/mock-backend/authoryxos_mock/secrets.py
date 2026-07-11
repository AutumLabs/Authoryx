"""Load the mock backend's secret store from environment variables.

Any env var matching `[A-Z][A-Z0-9_]*` that is not in the operator-config
allow-skip list is treated as a serveable secret.
"""

from __future__ import annotations

import os
import re

_KEY_RE = re.compile(r"^[A-Z][A-Z0-9_]{0,127}$")
_RESERVED = {
    "MOCK_OWNER_TOKEN",
    "MOCK_AUTO_APPROVE",
    "MOCK_DB_PATH",
    "PATH",
    "HOME",
    "PWD",
    "SHELL",
    "USER",
    "HOSTNAME",
    "LANG",
    "TERM",
}


def get_secret(key_name: str) -> str | None:
    if not _KEY_RE.match(key_name) or key_name in _RESERVED:
        return None
    return os.environ.get(key_name)
