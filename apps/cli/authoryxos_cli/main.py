"""`authoryxos` CLI entrypoint."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

import httpx

from . import precommit
from .rewriter import plan_file
from .scanner import Finding, scan_paths, scan_repo


def _print_findings(findings: list[Finding], *, json_out: bool) -> None:
    if json_out:
        json.dump(
            [
                {"path": str(f.path), "line": f.line, "rule": f.rule, "snippet": f.snippet}
                for f in findings
            ],
            sys.stdout,
            indent=2,
        )
        sys.stdout.write("\n")
        return
    if not findings:
        print("No secrets found.")
        return
    print(f"Found {len(findings)} potential secret(s):")
    for f in findings:
        print(f"  {f.path}:{f.line}  [{f.rule}]  {f.snippet}")


def _staged_files(repo_root: Path) -> list[Path]:
    try:
        out = subprocess.check_output(
            ["git", "diff", "--cached", "--name-only", "--diff-filter=ACMR"],
            cwd=repo_root,
            text=True,
        )
    except (subprocess.CalledProcessError, FileNotFoundError):
        return []
    return [repo_root / line.strip() for line in out.splitlines() if line.strip()]


def cmd_scan(args: argparse.Namespace) -> int:
    root = Path(args.path).resolve()
    if args.staged:
        files = [p for p in _staged_files(root) if p.is_file()]
        findings = scan_paths(files)
    else:
        findings = scan_repo(root)
    _print_findings(findings, json_out=args.json)
    return 1 if findings else 0


def cmd_init(args: argparse.Namespace) -> int:
    root = Path(args.path).resolve()
    print(f"Scanning {root} for hardcoded secrets…")
    findings = scan_repo(root)
    _print_findings(findings, json_out=False)
    try:
        hook = precommit.install(root)
        print(f"Installed pre-commit hook: {hook}")
    except FileNotFoundError as e:
        print(f"Skipping pre-commit hook: {e}", file=sys.stderr)
    return 1 if findings else 0


def _rel(path: Path, root: Path) -> str:
    return str(path.relative_to(root)) if path.is_relative_to(root) else str(path)


def cmd_migrate(args: argparse.Namespace) -> int:
    """Detect hardcoded secrets, upload them to the server, and rewrite source."""
    root = Path(args.path).resolve()
    findings = [f for f in scan_repo(root) if f.value]
    if not findings:
        print("No secrets found to migrate.")
        return 0

    by_file: dict[Path, list[Finding]] = defaultdict(list)
    for f in findings:
        by_file[f.path].append(f)

    used: set[str] = set()
    planned: list[tuple[Path, str]] = []
    actions = []
    for path, fs in sorted(by_file.items(), key=lambda kv: str(kv[0])):
        try:
            text = path.read_text(encoding="utf-8")
        except OSError:
            continue
        new_text, file_actions = plan_file(path, text, fs, used)
        planned.append((path, new_text))
        actions.extend(file_actions)

    print(f"Planned migration of {len(actions)} secret(s):")
    for a in actions:
        print(f"  {_rel(a.path, root)}:{a.line}  {a.key_name:<28} [{a.mode}]")

    if args.dry_run:
        print("\nDry run — no upload, no file changes.")
        return 0

    # 1. Upload secrets to the server (encrypted at rest).
    if not args.no_upload:
        api_key = args.api_key or os.environ.get("AUTHORYXOS_API_KEY", "")
        if not api_key:
            print(
                "Set --api-key or AUTHORYXOS_API_KEY (admin scope) to upload, "
                "or pass --no-upload.",
                file=sys.stderr,
            )
            return 2
        base = args.base_url.rstrip("/")
        headers = {"Authorization": f"Bearer {api_key}"}
        for a in actions:
            r = httpx.post(
                f"{base}/v1/admin/keys",
                headers=headers,
                json={
                    "key_name": a.key_name,
                    "value": a.value,
                    "source": f"scanner:{_rel(a.path, root)}:{a.line}",
                },
                timeout=15,
            )
            if r.status_code not in (200, 201):
                print(f"  upload failed for {a.key_name}: {r.status_code} {r.text}", file=sys.stderr)
                return 6
        print(f"Uploaded {len(actions)} secret(s) to {base}.")

    # 2. Rewrite source files to remove the literals.
    if not args.no_rewrite:
        for path, new_text in planned:
            path.write_text(new_text, encoding="utf-8")
        print(f"Rewrote {len(planned)} file(s).")

    # 3. Record a manifest (never contains secret values).
    mig_dir = root / ".authoryxos"
    mig_dir.mkdir(exist_ok=True)
    manifest = {
        "version": 1,
        "base_url": args.base_url,
        "migrations": [
            {
                "key_name": a.key_name,
                "path": _rel(a.path, root),
                "line": a.line,
                "rule": a.rule,
                "mode": a.mode,
            }
            for a in actions
        ],
    }
    (mig_dir / "migration.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"Wrote {mig_dir / 'migration.json'}.")

    # 4. Install/refresh the pre-commit guard.
    try:
        precommit.install(root)
    except FileNotFoundError:
        pass

    neutralized = [a for a in actions if a.mode == "neutralize"]
    if neutralized:
        print(f"\n{len(neutralized)} secret(s) neutralized in place — wire a fetch manually:")
        for a in neutralized:
            print(f"  TODO  {a.key_name}  at {_rel(a.path, root)}:{a.line}")
    return 0


def cmd_audit(args: argparse.Namespace) -> int:
    base = args.base_url.rstrip("/")
    api_key = args.api_key or os.environ.get("AUTHORYXOS_API_KEY", "")
    headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
    r = httpx.get(f"{base}/v1/os/audit", params={"limit": args.last}, headers=headers, timeout=10)
    r.raise_for_status()
    records = r.json().get("records", [])
    if args.json:
        json.dump(records, sys.stdout, indent=2)
        sys.stdout.write("\n")
        return 0
    if not records:
        print("No audit records.")
        return 0
    print(f"Last {len(records)} audit record(s):")
    for rec in records:
        print(
            f"  {rec.get('requested_at', '')}  {rec.get('decision', ''):<8}"
            f"  {rec.get('key_name', ''):<24}  {rec.get('agent_id', '')}"
        )
    return 0


def cmd_fetch(args: argparse.Namespace) -> int:
    api_key = args.api_key or os.environ.get("AUTHORYXOS_API_KEY", "")
    if not api_key:
        print("Set --api-key or AUTHORYXOS_API_KEY.", file=sys.stderr)
        return 2
    if args.dry_run:
        print(f"DRY RUN: would request key={args.key!r} intent={args.intent!r}")
        return 0
    from authoryxos import AccessDeniedError, Client, PendingTimeoutError, TransportError

    c = Client(api_key=api_key, base_url=args.base_url)
    try:
        s = c.fetch(key=args.key, intent=args.intent)
    except AccessDeniedError as e:
        print(f"DENIED: {e}", file=sys.stderr)
        return 3
    except PendingTimeoutError as e:
        print(f"TIMEOUT: {e}", file=sys.stderr)
        return 4
    except TransportError as e:
        print(f"TRANSPORT {e.code}: {e}", file=sys.stderr)
        return 5
    sys.stdout.write(s.reveal())
    sys.stdout.write("\n")
    return 0


def cmd_keys_list(args: argparse.Namespace) -> int:
    base = args.base_url.rstrip("/")
    api_key = args.api_key or os.environ.get("AUTHORYXOS_API_KEY", "")
    if not api_key:
        print("Set --api-key or AUTHORYXOS_API_KEY (admin scope).", file=sys.stderr)
        return 2
    r = httpx.get(f"{base}/v1/admin/keys", headers={"Authorization": f"Bearer {api_key}"}, timeout=10)
    r.raise_for_status()
    keys = r.json().get("keys", [])
    if args.json:
        json.dump(keys, sys.stdout, indent=2)
        sys.stdout.write("\n")
        return 0
    if not keys:
        print("No keys configured.")
        return 0
    print(f"{len(keys)} key(s):")
    for k in keys:
        print(f"  {k['key_name']:<28} {k.get('default_policy') or '-':<18} {k.get('description', '')}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="authoryxos", description="AuthoryxOS CLI")
    sub = p.add_subparsers(dest="command", required=True)

    s = sub.add_parser("scan", help="Detect hardcoded secrets without changing files.")
    s.add_argument("--path", default=".", help="Repository root (default: cwd).")
    s.add_argument("--staged", action="store_true", help="Only scan files staged for commit.")
    s.add_argument("--json", action="store_true", help="Emit findings as JSON.")
    s.set_defaults(func=cmd_scan)

    i = sub.add_parser("init", help="Scan + install pre-commit hook.")
    i.add_argument("--path", default=".", help="Repository root (default: cwd).")
    i.set_defaults(func=cmd_init)

    m = sub.add_parser(
        "migrate",
        help="Move hardcoded secrets to the server and rewrite code to fetch at runtime.",
    )
    m.add_argument("--path", default=".", help="Repository root (default: cwd).")
    m.add_argument("--base-url", default=os.environ.get("AUTHORYXOS_BASE_URL", "http://localhost:8787"))
    m.add_argument("--api-key", default=None, help="Admin-scoped API key (or AUTHORYXOS_API_KEY).")
    m.add_argument("--dry-run", action="store_true", help="Report only; no upload, no rewrite.")
    m.add_argument("--no-upload", action="store_true", help="Rewrite code but do not upload secrets.")
    m.add_argument("--no-rewrite", action="store_true", help="Upload secrets but do not edit files.")
    m.set_defaults(func=cmd_migrate)

    a = sub.add_parser("audit", help="Read the audit log from a backend.")
    a.add_argument("--base-url", default=os.environ.get("AUTHORYXOS_BASE_URL", "http://localhost:8787"))
    a.add_argument("--api-key", default=None)
    a.add_argument("--last", type=int, default=50)
    a.add_argument("--json", action="store_true")
    a.set_defaults(func=cmd_audit)

    f = sub.add_parser("fetch", help="Fetch a secret directly from the CLI.")
    f.add_argument("key")
    f.add_argument("--intent", required=True)
    f.add_argument("--base-url", default=os.environ.get("AUTHORYXOS_BASE_URL", "http://localhost:8787"))
    f.add_argument("--api-key", default=None)
    f.add_argument("--dry-run", action="store_true")
    f.set_defaults(func=cmd_fetch)

    k = sub.add_parser("keys", help="Manage configured keys.")
    ksub = k.add_subparsers(dest="keys_command", required=True)
    klist = ksub.add_parser("list", help="List secret names configured on the server.")
    klist.add_argument("--base-url", default=os.environ.get("AUTHORYXOS_BASE_URL", "http://localhost:8787"))
    klist.add_argument("--api-key", default=None)
    klist.add_argument("--json", action="store_true")
    klist.set_defaults(func=cmd_keys_list)

    return p


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return int(args.func(args))


if __name__ == "__main__":
    raise SystemExit(main())
