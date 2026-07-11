# Self-hosting AuthoryxOS

`apps/backend/` is a complete, production-grade, Authoryx-protocol-compatible
backend. Self-host it with one command:

```bash
make setup            # generates .env, builds, starts, migrates, prints admin key
```

This brings up the backend + Postgres via `docker-compose.yml`. The container
runs `alembic upgrade head` on start and serves on `:8787`.

## What you get

- All protocol endpoints — agent plane (`POST /v1/os/secrets/:key_name`,
  `GET /v1/os/pending/:token`, `POST /v1/os/decisions/:token`,
  `GET /v1/os/audit`) and the admin management plane (`/v1/admin/*`).
- **Encryption at rest** — AES-256-GCM envelope, a per-secret data key wrapped
  by `AUTHORYX_MASTER_KEY`. The DB holds only ciphertext.
- **Multi-tenant API keys** — hashed at rest, scoped (`agent` / `admin`) and
  optionally restricted to specific key names.
- **Pluggable policy engine** — auto-approve / require-human / deny, honoring
  `approve_once` / `always_approve` / `require_approval`.
- **Operator notifications** — webhook (HMAC-signed), Slack, email; all
  optional.
- **Owner dashboard** — approve/deny, manage secrets, agents, and API keys.
- **SQLite (dev) or Postgres (prod)** by connection string alone.
- Replay protection, clock-skew rejection, expiry handling, append-only audit.

## Configuration

All settings are `AUTHORYX_`-prefixed (see `apps/backend/.env.example` and the
deployment `.env.example`). In `prod`, `AUTHORYX_MASTER_KEY`,
`AUTHORYX_SESSION_SECRET`, and `AUTHORYX_OWNER_PASSWORD` are mandatory — the
backend refuses to start without them.

> **Back up `AUTHORYX_MASTER_KEY`.** It wraps every data key; losing it makes
> stored secrets unrecoverable. Rotating it requires re-wrapping data keys.

## Hardening checklist

- Terminate TLS in front of the backend (reverse proxy / load balancer).
- Set a strong `AUTHORYX_OWNER_PASSWORD`; restrict dashboard exposure.
- Issue narrowly-scoped `agent` API keys (per agent, with `allowed_keys`);
  reserve `admin` keys for operators and the `migrate` CLI.
- Configure at least one notification channel so pending approvals are seen.
- Take regular Postgres backups; store the master key in a secrets manager.

## Managed alternative

A hosted Authoryx deployment speaks the identical protocol and can add richer
policy/notification/AI-review behind the same endpoints — switch by changing
`AUTHORYXOS_BASE_URL`, with no SDK or agent change. Any backend that passes
`tests/conformance/` may claim Authoryx-protocol compatibility.
