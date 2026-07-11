# AuthoryxOS backend

Production, self-hostable implementation of the Authoryx protocol
(`docs/protocol-spec.md`). Multi-tenant, encrypted-at-rest, policy-gated,
with an owner dashboard. Runs on SQLite (dev) or Postgres (prod) by
connection string alone.

## What it provides

- **Agent plane** (`/v1/os/*`): the frozen protocol — submit intent, poll,
  decide, audit.
- **Admin plane** (`/v1/admin/*`): manage secrets, agents, and API keys.
- **Encryption at rest**: AES-256-GCM envelope, per-secret data keys wrapped
  by the master key. Plaintext exists only transiently while serving an
  approved fetch (`core/crypto.py`, `services/secret_store.py`).
- **Pluggable policy engine** (`policy/`): auto-approve / require-human / deny,
  honoring `approve_once` / `always_approve` / `require_approval`.
- **Notifications** (`notify/`): webhook (HMAC-signed), Slack, email — all
  optional.
- **Owner dashboard** (`dashboard/`): approve/deny, manage keys & agents.

## Run locally (SQLite, no Docker)

```bash
pip install -e ".[dev]"
authoryx-backend seed            # creates a tenant + demo TEST_KEY, prints an admin API key
authoryx-backend serve --reload  # http://localhost:8787  (dashboard at /dashboard)
```

## Run with Postgres (Docker)

See the repo-root `docker-compose.yml` and `make setup`. The container
entrypoint runs `alembic upgrade head` before serving.

## Configuration

All settings are `AUTHORYX_`-prefixed; see `.env.example`. In `prod`,
`AUTHORYX_MASTER_KEY`, `AUTHORYX_SESSION_SECRET`, and
`AUTHORYX_OWNER_PASSWORD` are mandatory.

## Tests

```bash
pip install -e ".[dev]"
pytest
```

## Migrations

```bash
alembic upgrade head             # apply
alembic revision --autogenerate -m "describe change"
```
