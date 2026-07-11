from __future__ import annotations

from pathlib import Path

from authoryxos_cli.scanner import scan_text, shannon_entropy


def test_finds_aws_access_key_id(tmp_path: Path) -> None:
    text = 'AWS_KEY = "AKIAIOSFODNN7EXAMPLE"'
    findings = scan_text(tmp_path / "x.py", text)
    rules = {f.rule for f in findings}
    assert "aws_access_key_id" in rules


def test_finds_github_token(tmp_path: Path) -> None:
    text = "token = 'ghp_" + "A" * 40 + "'"
    findings = scan_text(tmp_path / "x.py", text)
    assert any(f.rule == "github_token" for f in findings)


def test_finds_authoryxos_key(tmp_path: Path) -> None:
    text = 'AUTHORYXOS_API_KEY = "axos_live_' + "Z" * 24 + '"'
    findings = scan_text(tmp_path / "x.py", text)
    assert any(f.rule == "authoryxos_api_key" for f in findings)


def test_generic_high_entropy_caught(tmp_path: Path) -> None:
    # 40-char random-looking string
    text = 'password = "X7q9!fA2zP3mN8vQ1bR5cT4yU6wH0jK2lD3oI9eS"'
    findings = scan_text(tmp_path / "x.py", text)
    assert any(f.rule == "generic_high_entropy_assignment" for f in findings)


def test_generic_low_entropy_skipped(tmp_path: Path) -> None:
    text = 'password = "aaaaaaaaaaaaaaaaaaaa"'
    findings = scan_text(tmp_path / "x.py", text)
    assert not any(f.rule == "generic_high_entropy_assignment" for f in findings)


def test_shannon_entropy_monotone() -> None:
    assert shannon_entropy("aaaaaaaa") < shannon_entropy("ab" * 4) < shannon_entropy("X7q9!fA2zP3mN8vQ1bR5cT4yU6wH0jK2")
