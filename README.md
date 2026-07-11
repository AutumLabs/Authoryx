# AuthoryxOS

The open-source identity delegation and secret access engine for agentic
AI. Powers [Authoryx](https://authoryx.dev). Built by AutumLabs.
Licensed Apache 2.0.

## The problem

Every agentic AI system today has hardcoded secrets, no audit trail, and
no human oversight over what credentials an agent accesses and why.

## The fix

Three principles:

1. **One secret per agent** — the agent carries only an AuthoryxOS API
   key. Everything else is fetched on demand.
2. **Intent before access** — every secret fetch must carry a
   natural-language reason string from the agent.
3. **Human in the loop** — the system owner reviews intent declarations,
   approves or denies, and the agent pauses and resumes around the
   decision without losing execution state.

## Quickstart

One command brings up the full stack (backend + Postgres), runs migrations,
and prints an admin API key + dashboard URL:

```bash
make setup            # or: ./scripts/bootstrap.sh
```

Then move a repo's hardcoded secrets into AuthoryxOS and rewrite the code to
fetch them at runtime:

```bash
export AUTHORYXOS_API_KEY=axos_live_…      # the admin key printed above
export AUTHORYXOS_BASE_URL=http://localhost:8787
pip install -e packages/sdk-python -e apps/cli
authoryxos migrate --dry-run               # preview, then drop --dry-run
```

Approve pending fetches at <http://localhost:8787/dashboard>. For a
no-Docker dev loop on SQLite, see `apps/backend/README.md` (`make dev-backend`).
Full walkthrough — including human-in-the-loop approval and pause/resume
across process restarts — in `docs/quickstart.md`.

## Repo layout

| Path                              | What it is                                   |
| --------------------------------- | -------------------------------------------- |
| `docs/protocol-spec.md`           | Wire-format contract (agent + admin planes). |
| `docs/architecture.md`            | System architecture and extension guide.     |
| `packages/protocol/`              | JSON Schemas for protocol payloads.          |
| `apps/backend/`                   | Production backend: FastAPI, encrypted-at-rest store, multi-tenant API keys, policy engine, notifications, owner dashboard. |
| `packages/sdk-python/`            | Python SDK (`authoryxos`) + `fetch()` helper. |
| `packages/sdk-typescript/`        | TypeScript SDK (`authoryxos`).               |
| `plugins/openclaw/`               | OpenClaw plugin.                             |
| `plugins/hermes/`                 | Hermes Agent plugin (`authoryxos-hermes`).   |
| `plugins/claude-code/`            | Claude Code MCP server + agent skill.        |
| `apps/cli/`                       | `authoryxos` CLI (`scan`, `init`, `migrate`, `audit`, `fetch`, `keys`). |
| `tests/conformance/`              | Backend protocol conformance suite.          |
| `legacy/`                         | Earlier scaffolds (Node SMS-relay; FastAPI mock backend). Reference only. |

## Documentation

- [Protocol spec](docs/protocol-spec.md)
- [Architecture & extension guide](docs/architecture.md)
- [Quickstart](docs/quickstart.md)
- [Self-hosting](docs/self-hosting.md)

## Self-hosted vs. managed

The same wire protocol backs both. Self-host `apps/backend` (this repo), or
point the SDK at a hosted Authoryx deployment — no agent or SDK change. Any
backend that passes `tests/conformance/` is Authoryx-protocol-compatible. The
policy engine and notifier are pluggable seams where a managed layer adds
richer review without breaking compatibility.

## License

Apache 2.0. See `LICENSE`.
