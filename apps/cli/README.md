# authoryxos CLI

```bash
pip install authoryxos-cli
```

## Commands

```bash
authoryxos init      # scan the repo + install pre-commit hook
authoryxos scan      # scan only, no changes
authoryxos scan --staged   # scan only files staged for commit (used by the hook)
authoryxos audit --last 50
authoryxos fetch KEY --intent "..." [--dry-run]
authoryxos keys list       # placeholder in v0.1.0
```

`fetch` and `audit` default to the local mock backend at
`http://localhost:8787`. Override with `--base-url` or the
`AUTHORYXOS_BASE_URL` env var. The API key is read from
`--api-key` or `AUTHORYXOS_API_KEY`.

## Scanner

The scanner combines:

- Named regex patterns for AWS / GitHub / Slack / Stripe / OpenAI
  / AuthoryxOS keys.
- A generic `password|secret|api_key|token = "…"` matcher with a
  Shannon-entropy floor of 3.5 to avoid placeholder strings.

For production-grade detection, layer
[gitleaks](https://github.com/gitleaks/gitleaks) on top.

## Pre-commit hook

`authoryxos init` writes `.git/hooks/pre-commit` that runs
`authoryxos scan --staged` and aborts the commit on any finding.
