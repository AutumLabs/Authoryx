# Quickstart

From zero to a working, audited secret fetch in a few minutes.

## 1. Start the stack

```bash
make setup            # or: ./scripts/bootstrap.sh
```

This generates secrets into `.env`, builds and starts the backend +
Postgres, runs migrations, and prints an **admin API key** plus the
dashboard URL. The backend serves at <http://localhost:8787>; the owner
dashboard is at <http://localhost:8787/dashboard> (password in `.env`).

> No Docker? Run the backend on SQLite instead:
> `cd apps/backend && pip install -e ".[dev]" && authoryx-backend seed && authoryx-backend serve --reload`

## 2. Install the SDK + CLI

```bash
pip install -e packages/sdk-python -e apps/cli
export AUTHORYXOS_API_KEY=axos_live_…      # the admin key from step 1
export AUTHORYXOS_BASE_URL=http://localhost:8787
```

## 3. Fetch a secret

The seed created a demo `TEST_KEY`. With the default `require_approval`
policy this fetch **pauses** until you approve it in the dashboard:

```python
from authoryxos import Client
c = Client(api_key="<your key>", base_url="http://localhost:8787")
print(c.fetch(key="TEST_KEY", intent="trying out AuthoryxOS").reveal())
```

Visit <http://localhost:8787/dashboard>, click **Approve**, and the script
resumes and prints `hello-from-authoryxos`.

## 4. Move real secrets out of a codebase

```bash
authoryxos migrate --dry-run        # preview findings + planned rewrites
authoryxos migrate                  # upload (encrypted) + rewrite + install pre-commit hook
```

Recognized assignments become `fetch("KEY_NAME", intent=…)`; everything else
is neutralized in place and listed as a TODO. A manifest is written to
`.authoryxos/migration.json` (never any secret values).

## 5. Pause / resume across process restarts

1. Start a `fetch()` against a key with `require_approval`.
2. Kill the script while it polls.
3. Re-run with `Client(...).resume_pending()` — it re-attaches to the same
   pending token and resolves once you approve. The local pause store holds
   only the token and poll URL, **never the secret**.

## 6. Verify protocol conformance

```bash
AUTHORYXOS_BASE_URL=http://localhost:8787 AUTHORYXOS_ADMIN_KEY=<admin key> \
  make conformance
```
