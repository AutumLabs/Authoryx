# AuthoryxOS — Claude Code Context

## What this project is

AuthoryxOS is the open-source identity delegation and secret access engine
for agentic AI. It is **self-hostable end-to-end** and also powers the
hosted Authoryx product.

Built by AutumLabs. Licensed Apache 2.0.

The core problem: every agentic AI system today has hardcoded secrets,
no audit trail, and no human oversight over what credentials an agent
accesses and why. AuthoryxOS fixes this with three principles:

1. **One secret per agent** — the agent carries only an AuthoryxOS API key.
   Everything else is fetched on demand.
2. **Intent before access** — every secret fetch must carry a natural-language
   reason string from the agent explaining why it needs that credential.
3. **Human in the loop** — the system owner reviews intent declarations,
   approves or denies, and the agent pauses and resumes around that
   decision without losing execution state.

## Scope (updated)

This repo ships a **complete, self-deployable stack** — not just the SDK.
The previous design deferred the backend, vault, and dashboard to a
closed-source product; that boundary has been intentionally removed so the
open-source project is usable standalone.

Included here:

- **SDKs** (Python, TypeScript) — `client.fetch`, `with_secret`, pause/resume.
- **Scanner CLI** — detect hardcoded secrets, **migrate** them to the server,
  rewrite source to fetch at runtime, install a pre-commit guard.
- **Production backend** (`apps/backend`) — FastAPI, multi-tenant API keys,
  **encryption at rest** (AES-256-GCM envelope, per-secret DEK), a pluggable
  **policy engine**, operator **notifications** (email/webhook/Slack), and a
  server-rendered **owner dashboard** (Jinja + HTMX). Runs on SQLite (dev) or
  Postgres (prod) by connection string only.
- **Plugins** — Claude Code MCP server + skill, OpenClaw, Hermes.
- **Protocol + conformance** — the wire contract any backend must satisfy.

"Authoryx-managed" is a drop-in alternative **backend deployment** that
speaks the identical protocol (passes `tests/conformance/`) and supplies
richer `PolicyEngine` / `Notifier` implementations. No SDK or agent change
is required to switch between self-hosted and managed.

## Architecture

```
Agentic AI system (OpenClaw / Hermes Agent / Claude Code / custom)
│  carries only: AUTHORYXOS_API_KEY
▼
AuthoryxOS SDK  [open source — runs in-process]
├── intent capture       wraps every fetch with a reason string
├── with_secret(exec=…)  injects the secret for one call, then zeroes it
└── pause / resume       suspends and resumes around human decisions (NO secrets on disk)
│
▼  HTTPS + intent payload
│  { api_key, key_name, intent, agent_id, session_id, nonce, timestamp, policy_hint }
▼
AuthoryxOS backend  [open source, self-hosted — apps/backend; OR Authoryx-managed]
├── multi-tenant API-key auth + per-key/per-agent scope
├── policy engine        auto-approve / require-human / deny  (+ effective_policy)
├── notifier             email / webhook / Slack on pending
├── owner dashboard      approve / deny / manage keys & agents
└── secret store         encrypted at rest (AES-256-GCM envelope, per-secret DEK)
│
▼
Immutable audit trail
```

## Build priority order

Phases in `docs/architecture.md` (§2) and the build plan at
`/Users/sumerthakur/.claude/plans/review-the-authoryx-os-system-linear-donut.md`.
The agent-facing fetch protocol (`/v1/os/...`) is frozen; admin endpoints
(`/v1/admin/...`) are additive within v1.

## Security requirements — non-negotiable

- Raw secret values are **never logged** anywhere under any circumstances.
- Secrets are **encrypted at rest** in the backend; plaintext exists only
  transiently in memory while serving an approved fetch.
- Nonces are single-use — replays rejected.
- The `with_secret()` / injected-execution pattern must always be available
  as an alternative to returning raw strings.
- Pause state serialized to disk must never include the secret value —
  only the PENDING token and polling URL.
- The pre-commit hook installed by `authoryxos init` must run
  `authoryxos scan` and block commits containing high-entropy strings
  matching secret patterns.
- API keys are stored **hashed**; only the `axos_live_` prefix + last 4 are
  ever shown after issuance.

## Code style

- Python: PEP 8, full type hints, async-first.
- TypeScript: strict mode, no `any`, async/await.
- All public functions documented with docstrings / JSDoc.
- Every module has a corresponding test file.
- Error messages are human-readable — agent developers will read them.

## v1 ships when

1. `make setup` (or `docker compose up`) brings up backend + Postgres + Redis
   and prints a usable `axos_live_…` key + dashboard URL.
2. `pip install -e packages/sdk-python` and
   `client.fetch(key="TEST_KEY", intent="testing the SDK")` works.
3. Pending request shows in the dashboard; manual approval returns the secret
   to the paused process; resume across process restart works.
4. `authoryxos migrate` moves a hardcoded secret out of a repo and the code
   fetches it at runtime; a re-scan reports clean.
5. `tests/conformance/` passes against `apps/backend`.

## Reference repos

- `supermemoryai/supermemory` — SDK structural reference.
- `supermemoryai/openclaw-supermemory` — OpenClaw plugin shape.
- `NousResearch/hermes-agent` — memory provider interface.
- `gitleaks/gitleaks` — secret detection patterns.

## Legacy

`legacy/` holds the earlier Node/TS scaffold (SMS-relay framing). It is
retained for reference only and is not part of the build or deploy.
</content>
