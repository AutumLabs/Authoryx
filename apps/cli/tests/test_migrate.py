"""Tests for the `migrate` rewrite pipeline (offline; no server)."""

from __future__ import annotations

import ast
import json
from pathlib import Path

from authoryxos_cli.main import main
from authoryxos_cli.rewriter import plan_file, screaming_snake
from authoryxos_cli.scanner import scan_repo


def test_screaming_snake():
    assert screaming_snake("stripeSecretKey") == "STRIPE_SECRET_KEY"
    assert screaming_snake("api_key") == "API_KEY"
    assert screaming_snake("DBPassword") == "DBPASSWORD"


def _make_repo(tmp_path: Path) -> Path:
    (tmp_path / "app.py").write_text(
        "import os\n"
        'API_KEY = "sk-abcdefghijklmnopqrstuvwxyz123456"\n'
        "def go():\n"
        "    return API_KEY\n"
    )
    (tmp_path / "config.yaml").write_text(
        'github_token: "ghp_abcdefghijklmnopqrstuvwxyz0123456789"\n'
    )
    return tmp_path


def test_plan_file_rewrites_python(tmp_path):
    repo = _make_repo(tmp_path)
    findings = [f for f in scan_repo(repo) if f.path.name == "app.py"]
    text = (repo / "app.py").read_text()
    new_text, actions = plan_file(repo / "app.py", text, findings, set())

    assert "sk-abcdefghijklmnopqrstuvwxyz123456" not in new_text
    assert "from authoryxos import fetch" in new_text
    assert 'fetch("API_KEY"' in new_text
    # Rewritten Python must still parse.
    ast.parse(new_text)
    assert any(a.mode == "rewrite" and a.key_name == "API_KEY" for a in actions)


def test_migrate_cli_no_upload(tmp_path):
    repo = _make_repo(tmp_path)
    rc = main(["migrate", "--path", str(repo), "--no-upload"])
    assert rc == 0

    app = (repo / "app.py").read_text()
    cfg = (repo / "config.yaml").read_text()
    assert "sk-abcdefghijklmnopqrstuvwxyz123456" not in app
    assert "ghp_abcdefghijklmnopqrstuvwxyz0123456789" not in cfg

    manifest = json.loads((repo / ".authoryxos" / "migration.json").read_text())
    names = {m["key_name"] for m in manifest["migrations"]}
    assert "API_KEY" in names
    # A re-scan should now find nothing.
    assert [f for f in scan_repo(repo) if f.value] == []


def test_migrate_dry_run_changes_nothing(tmp_path):
    repo = _make_repo(tmp_path)
    before = (repo / "app.py").read_text()
    rc = main(["migrate", "--path", str(repo), "--dry-run"])
    assert rc == 0
    assert (repo / "app.py").read_text() == before
    assert not (repo / ".authoryxos").exists()
