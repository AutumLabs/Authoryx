"""Secret scanner used by `authoryxos scan` and `authoryxos init`.

A minimal scanner combining:

1. Named regex patterns for well-known secret formats (AWS, GitHub, Slack,
   Stripe, OpenAI, generic high-entropy assignments).
2. A Shannon-entropy check for long string literals.

This is a deliberately small, dependency-free starting point. The
`authoryxos init` path is meant to be a no-friction first step, not
a definitive secret scanner. For production-grade detection point
users at gitleaks or trufflehog.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

# Files we never scan.
_SKIP_DIRS = {
    ".git", "node_modules", "dist", "build", "__pycache__",
    ".venv", "venv", ".tox", ".mypy_cache", ".pytest_cache",
    ".authoryxos",
}
_SKIP_SUFFIXES = {
    ".lock", ".min.js", ".map", ".png", ".jpg", ".jpeg", ".gif",
    ".pdf", ".zip", ".tar", ".gz", ".bz2", ".whl", ".so", ".dylib",
    ".pyc",
}

# Named patterns (description, pattern). Patterns capture the secret in group 0.
_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("aws_access_key_id",  re.compile(r"AKIA[0-9A-Z]{16}")),
    ("aws_secret_key",     re.compile(r"(?i)aws.{0,20}?(?:secret|access).{0,5}?[\"']([A-Za-z0-9/+=]{40})[\"']")),
    ("github_token",       re.compile(r"gh[pousr]_[A-Za-z0-9]{36,}")),
    ("slack_token",        re.compile(r"xox[abpr]-[A-Za-z0-9-]{10,}")),
    ("stripe_live_key",    re.compile(r"sk_live_[A-Za-z0-9]{24,}")),
    ("openai_key",         re.compile(r"sk-[A-Za-z0-9]{20,}")),
    ("authoryxos_api_key", re.compile(r"axos_live_[A-Za-z0-9]{20,}")),
    ("generic_high_entropy_assignment",
     re.compile(r"(?i)(?:password|passwd|secret|api[_-]?key|token)\s*[:=]\s*[\"']([^\"'\s]{16,})[\"']")),
)

# Entropy thresholds for the "generic" pattern: if the captured value's
# Shannon entropy is below this, it's likely a placeholder, not a secret.
_ENTROPY_FLOOR = 3.5

# Values already migrated by `authoryxos migrate` carry this marker and must
# not be re-flagged on a subsequent scan.
_MANAGED_MARKER = "AUTHORYXOS_MANAGED:"


@dataclass(frozen=True)
class Finding:
    path: Path
    line: int
    rule: str
    snippet: str
    # The detected secret literal and its column span within the line. These
    # power `authoryxos migrate`'s in-place rewrite. Defaults keep older
    # callers (and tests) working.
    value: str = ""
    col_start: int = -1
    col_end: int = -1


def shannon_entropy(s: str) -> float:
    if not s:
        return 0.0
    counts: dict[str, int] = {}
    for ch in s:
        counts[ch] = counts.get(ch, 0) + 1
    n = len(s)
    return -sum((c / n) * math.log2(c / n) for c in counts.values())


def _iter_files(root: Path) -> Iterable[Path]:
    for p in root.rglob("*"):
        if not p.is_file():
            continue
        if any(part in _SKIP_DIRS for part in p.parts):
            continue
        if p.suffix.lower() in _SKIP_SUFFIXES:
            continue
        try:
            if p.stat().st_size > 1_000_000:
                continue
        except OSError:
            continue
        yield p


def scan_text(path: Path, text: str) -> list[Finding]:
    out: list[Finding] = []
    for i, line in enumerate(text.splitlines(), start=1):
        for rule, pat in _PATTERNS:
            m = pat.search(line)
            if not m:
                continue
            # The secret itself is group(1) when the pattern captures it
            # (assignments), else the whole match.
            group_idx = 1 if m.lastindex else 0
            value = m.group(group_idx)
            if value.startswith(_MANAGED_MARKER):
                continue  # already migrated
            if rule == "generic_high_entropy_assignment":
                if shannon_entropy(value) < _ENTROPY_FLOOR:
                    continue
            start, end = m.span(group_idx)
            out.append(
                Finding(
                    path=path,
                    line=i,
                    rule=rule,
                    snippet=line.strip()[:160],
                    value=value,
                    col_start=start,
                    col_end=end,
                )
            )
    return out


def scan_paths(paths: Iterable[Path]) -> list[Finding]:
    findings: list[Finding] = []
    for p in paths:
        try:
            text = p.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        findings.extend(scan_text(p, text))
    return findings


def scan_repo(root: Path) -> list[Finding]:
    return scan_paths(_iter_files(root))
