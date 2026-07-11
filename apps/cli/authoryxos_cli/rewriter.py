"""Source rewriting for `authoryxos migrate`.

Given scanner findings, this produces edited file contents that remove the
hardcoded secret literal. Two modes:

- **rewrite** (Python ``IDENT = "literal"`` assignments): replace the literal
  with a runtime ``fetch("KEY_NAME", intent=...)`` call and ensure the
  ``from authoryxos import fetch`` import is present. The secret is fetched on
  demand with intent + approval + audit.
- **neutralize** (everything else): replace just the secret characters in
  place with an ``AUTHORYXOS_MANAGED:KEY_NAME`` marker, keeping surrounding
  syntax intact, and flag a TODO so a human/agent can wire a real fetch.

The literal is always removed from source either way — that is the goal.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

from .scanner import Finding

_KEY_NAME_RE = re.compile(r"^[A-Z][A-Z0-9_]{0,127}$")
_IMPORT_LINE = "from authoryxos import fetch"

# IDENT [: type] = <quote> ... <quote>  [trailing comment]
_PY_ASSIGN_RE = re.compile(
    r"^(?P<indent>\s*)(?P<ident>[A-Za-z_][A-Za-z0-9_]*)\s*"
    r"(?::\s*[^=]+?\s*)?=\s*(?P<q>['\"]).*(?P=q)\s*(?:#.*)?$"
)

# Fallback names per rule when no assignment identifier is available.
_RULE_NAMES = {
    "aws_access_key_id": "AWS_ACCESS_KEY_ID",
    "aws_secret_key": "AWS_SECRET_ACCESS_KEY",
    "github_token": "GITHUB_TOKEN",
    "slack_token": "SLACK_TOKEN",
    "stripe_live_key": "STRIPE_SECRET_KEY",
    "openai_key": "OPENAI_API_KEY",
    "authoryxos_api_key": "AUTHORYXOS_API_KEY",
    "generic_high_entropy_assignment": "SECRET",
}


@dataclass
class Action:
    path: Path
    line: int
    rule: str
    key_name: str
    value: str
    mode: str  # "rewrite" | "neutralize"


def screaming_snake(ident: str) -> str:
    """``stripeSecretKey`` / ``stripe_secret_key`` -> ``STRIPE_SECRET_KEY``."""
    s = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", "_", ident)
    s = re.sub(r"[^A-Za-z0-9]+", "_", s).strip("_").upper()
    return s or "SECRET"


def derive_key_name(finding: Finding, ident: str | None, used: set[str]) -> str:
    base = screaming_snake(ident) if ident else _RULE_NAMES.get(finding.rule, "SECRET")
    if not _KEY_NAME_RE.match(base):
        base = "SECRET"
    name = base
    n = 2
    while name in used:
        name = f"{base}_{n}"
        n += 1
    used.add(name)
    return name


def _ensure_import(lines: list[str]) -> list[str]:
    if any(line.strip() == _IMPORT_LINE for line in lines):
        return lines
    idx = 0
    if lines and lines[0].startswith("#!"):
        idx = 1
    # Skip a `from __future__` block so it stays first (required by Python).
    while idx < len(lines) and lines[idx].startswith("from __future__"):
        idx += 1
    lines.insert(idx, _IMPORT_LINE)
    return lines


def _intent_text(key_name: str, path: Path, line: int) -> str:
    return f"runtime access to {key_name} (migrated from {path.name}:{line})"


def plan_file(
    path: Path, text: str, findings: list[Finding], used_names: set[str]
) -> tuple[str, list[Action]]:
    """Return (new_text, actions) for one file. Does not write to disk."""
    lines = text.splitlines(keepends=False)
    actions: list[Action] = []
    is_python = path.suffix == ".py"
    needs_import = False

    # Multiple patterns can match the same line (e.g. a provider pattern AND
    # the generic assignment pattern). Collapse to one finding per line,
    # keeping the longest detected value (the most specific).
    best_per_line: dict[int, Finding] = {}
    for f in findings:
        cur = best_per_line.get(f.line)
        if cur is None or len(f.value) > len(cur.value):
            best_per_line[f.line] = f

    for finding in sorted(best_per_line.values(), key=lambda f: f.line):
        if finding.line < 1 or finding.line > len(lines):
            continue
        line = lines[finding.line - 1]
        ident = None
        m = _PY_ASSIGN_RE.match(line) if is_python else None
        if m:
            ident = m.group("ident")

        key_name = derive_key_name(finding, ident, used_names)

        if is_python and m and finding.value:
            intent = _intent_text(key_name, path, finding.line)
            indent = m.group("indent")
            lines[finding.line - 1] = (
                f'{indent}{ident} = fetch("{key_name}", '
                f'intent="{intent}")  # authoryxos: migrated, was hardcoded'
            )
            needs_import = True
            actions.append(Action(path, finding.line, finding.rule, key_name, finding.value, "rewrite"))
        elif finding.value and finding.col_start >= 0:
            # Neutralize in place: replace only the secret characters.
            new_line = line[: finding.col_start] + f"AUTHORYXOS_MANAGED:{key_name}" + line[finding.col_end :]
            lines[finding.line - 1] = new_line
            actions.append(Action(path, finding.line, finding.rule, key_name, finding.value, "neutralize"))

    if needs_import:
        lines = _ensure_import(lines)

    new_text = "\n".join(lines)
    if text.endswith("\n"):
        new_text += "\n"
    return new_text, actions
