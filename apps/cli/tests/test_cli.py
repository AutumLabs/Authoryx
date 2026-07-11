from __future__ import annotations

import json
import subprocess
from pathlib import Path

from authoryxos_cli.main import build_parser, main


def test_scan_clean_repo(tmp_path: Path, capsys) -> None:
    (tmp_path / "ok.py").write_text("x = 1\n")
    rc = main(["scan", "--path", str(tmp_path)])
    assert rc == 0
    assert "No secrets found" in capsys.readouterr().out


def test_scan_dirty_repo(tmp_path: Path) -> None:
    (tmp_path / "leak.py").write_text("KEY = 'AKIAIOSFODNN7EXAMPLE'\n")
    rc = main(["scan", "--path", str(tmp_path), "--json"])
    assert rc == 1


def test_init_installs_hook(tmp_path: Path) -> None:
    subprocess.run(["git", "init", "-q"], cwd=tmp_path, check=True)
    (tmp_path / "clean.py").write_text("x = 1\n")
    rc = main(["init", "--path", str(tmp_path)])
    assert rc == 0
    hook = tmp_path / ".git" / "hooks" / "pre-commit"
    assert hook.exists()
    assert hook.stat().st_mode & 0o111  # executable


def test_fetch_dry_run() -> None:
    rc = main([
        "fetch", "TEST_KEY", "--intent", "x",
        "--api-key", "axos_live_" + "a" * 20,
        "--dry-run",
    ])
    assert rc == 0


def test_parser_builds() -> None:
    p = build_parser()
    args = p.parse_args(["scan", "--path", "."])
    assert args.command == "scan"
