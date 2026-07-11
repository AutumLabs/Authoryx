---
name: authoryxos-secrets
description: Use whenever you need a credential, API key, token, password, or any secret to perform a task (call an API, connect to a database, authenticate to a service). Also use before writing code that would otherwise hardcode a secret. Fetches secrets on demand from AuthoryxOS with a stated intent instead of reading them from source, env files, or hardcoded literals.
---

# AuthoryxOS secrets

You do not have, and must not invent, hardcode, or guess, any secret value.
Every credential is fetched on demand from AuthoryxOS through one tool, held
only for the immediate operation, and never written down.

## The rule

When a task needs a secret:

1. Call the MCP tool **`authoryxos_fetch_secret`** with:
   - `key`: the secret's name in `SCREAMING_SNAKE_CASE` (e.g. `STRIPE_SECRET_KEY`).
   - `intent`: a specific, plain-language reason for THIS use — the human owner
     reads it to approve or deny. Good: "Charge $42 to customer cus_123 for
     invoice INV-1042." Bad: "need stripe key."
2. Use the returned value for that single operation only.
3. Never log it, print it, echo it, write it to a file, put it in a commit, or
   repeat it back in your response. Treat the value as write-once, use-once.

## Handling the result

- `ok: true` → use `value` for the operation, then discard it.
- `ok: false` with `error.code = "denied"` → the owner declined. Do not retry
  the same request or look for the secret elsewhere. Tell the user it was
  denied and stop that step.
- `ok: false` with other codes (`unknown_key`, `forbidden`, `invalid_intent`)
  → report the message; do not work around it.
- The fetch may pause pending human approval; that is normal. Wait for it.

## Never do this

- ❌ Read secrets from `.env`, `os.environ`, config files, or prior messages.
- ❌ Hardcode a secret literal in code you write.
- ❌ Cache a fetched secret in a variable for reuse across unrelated steps —
  fetch again with a fresh intent.
- ❌ Ask the user to paste a secret into the chat.

## Migrating an existing codebase

If you find hardcoded secrets in a repo, do not just move them to `.env`.
Run the CLI to move them into AuthoryxOS and rewrite the code to fetch at
runtime:

```bash
authoryxos migrate --base-url <backend-url> --api-key <admin-key>
```

This uploads each secret to the server (encrypted), rewrites recognized
assignments to `fetch("KEY_NAME", intent=...)`, neutralizes the rest with a
`AUTHORYXOS_MANAGED:` marker for you to wire up, writes
`.authoryxos/migration.json`, and installs a pre-commit hook that blocks new
hardcoded secrets. Use `--dry-run` first to preview.

## Setup (once per environment)

The tool needs `AUTHORYXOS_API_KEY` (and optionally `AUTHORYXOS_BASE_URL`) in
the MCP server's environment. See `plugins/claude-code/README.md` for the
`.mcp.json` snippet. The agent carries only this one key; every real
credential is fetched through it.
