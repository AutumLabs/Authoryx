"""Installs a pre-commit hook that runs `authoryxos scan --staged`."""

from __future__ import annotations

import os
import stat
from pathlib import Path

HOOK = """#!/usr/bin/env bash
# Installed by `authoryxos init`. Blocks commits that introduce secrets.
set -e
if ! command -v authoryxos >/dev/null 2>&1; then
  echo "authoryxos CLI not found on PATH; skipping scan." >&2
  exit 0
fi
authoryxos scan --staged
"""


def install(repo_root: Path) -> Path:
    hook_dir = repo_root / ".git" / "hooks"
    if not hook_dir.is_dir():
        raise FileNotFoundError(f"{hook_dir} not found — is this a git repo?")
    hook = hook_dir / "pre-commit"
    hook.write_text(HOOK)
    mode = hook.stat().st_mode
    hook.chmod(mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    return hook
