# AuthoryxOS Architecture

This document describes the overall AuthoryxOS architecture, the v0.1.0
phased build order, and the extension surface for adding new SDKs, new
agent framework integrations, and new backends.

## 1. System overview

```
┌─────────────────────────────────────────────────────────────────────┐
│ Agent process (OpenClaw, Hermes, Claude Code, custom)               │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │ AuthoryxOS SDK                                              │    │
│  │   client.fetch(key, intent)                                 │    │
│  │   client.with_secret(key, intent, exec=…)                   │    │
│  │   pause/resume store (~/.authoryxos/pause.db) — no secrets  │    │
│  └─────────────────────────────────────────────────────────────┘    │
└───────────────────────────────┬─────────────────────────────────────┘
                                │ HTTPS + intent payload
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Authoryx-compatible backend (self-hosted apps/backend or hosted)    │
│   policy engine · owner dashboard · encrypted-at-rest store · audit │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
                                ▼
                          Immutable audit trail
```

**Trust boundaries**

- Agent ↔ SDK: same process, full trust.
- SDK ↔ backend: untrusted network, mTLS or HTTPS + bearer key.
- Backend ↔ owner: out-of-band channel (web dashboard, mobile push).

## 2. Phased build order

Strict ordering — do not start a phase before the previous one is done.

| Phase | Deliverable                          | Location                       |
| ----- | ------------------------------------ | ------------------------------ |
| 1     | Protocol spec + JSON Schemas (agent + admin planes) | `docs/protocol-spec.md`, `packages/protocol/` |
| 2     | Production backend (FastAPI, Postgres/SQLite, encrypted-at-rest, multi-tenant, policy engine, notifier, dashboard) | `apps/backend/` |
| 3     | Python SDK + `fetch()` helper        | `packages/sdk-python/`         |
| 4     | Plugins (Claude Code MCP + skill, OpenClaw, Hermes) | `plugins/`        |
| 5     | TypeScript SDK                       | `packages/sdk-typescript/`     |
| 6     | CLI (`scan`, `init`, `migrate`, `audit`, `fetch`, `keys`) | `apps/cli/`     |

The earlier FastAPI mock backend now lives in `legacy/mock-backend/` for
reference; `apps/backend/` supersedes it for self-hosting.

## 3. Data flows

### 3.1 Immediate approve (auto-approve dev mode)

1. Agent calls `client.fetch(key, intent)`.
2. SDK validates API key format, builds payload, signs nothing (bearer).
3. `POST /v1/os/secrets/:key_name`.
4. Backend writes audit row with `decision=approved`, returns secret.
5. SDK returns `SecretStr` wrapper to caller.

### 3.2 Pending → approve

1. Steps 1–3 identical.
2. Backend returns `status=pending` with `token`, `poll_url`, `poll_interval`.
3. SDK writes `{token, poll_url, key, agent_id, session_id, expires_at}` to local pause store. **Secret never touches this store.**
4. SDK polls `GET /v1/os/pending/:token` every `poll_interval` seconds.
5. Owner approves out-of-band → poll returns `approved` + secret.
6. SDK deletes pause row, returns secret.

### 3.3 Denied

Poll returns `status=denied` → SDK raises `AccessDeniedError(reason)`.

### 3.4 Replay

Reusing a nonce returns `error.code=replayed_nonce` → SDK raises `TransportError` (non-retryable).

### 3.5 Timeout

If `expires_at` passes while polling, SDK raises `PendingTimeoutError`.

### 3.6 Resume across process restart

`Client.resume_pending()` scans the pause DB, re-polls each live token, resolves or surfaces errors as if the original call had not been interrupted.

## 4. Extension points

### 4.1 New SDK language

1. Implement the four endpoints in `docs/protocol-spec.md`.
2. Validate payloads against `packages/protocol/*.schema.json`.
3. Mirror the pause-store schema in `packages/sdk-python/authoryxos/pause.py` (same SQLite layout — enables cross-language resume).
4. Pass the conformance suite (`tests/conformance/`) against the mock backend.

### 4.2 New agent framework integration

1. Build a thin adapter in `plugins/<framework>/`.
2. Register a secret provider with the framework's plugin interface.
3. Capture an intent string from the agent's tool-call context.
4. Forward `(key, intent)` to the SDK; surface pause/resume to the framework's event loop.

Reference adapters:

- `plugins/openclaw/` — modeled on `supermemoryai/openclaw-supermemory`.
- `plugins/hermes/` — modeled on Hermes Agent memory providers.
- `plugins/claude-code/` — exposes an MCP server.

### 4.3 New backend

1. Implement the four endpoints.
2. Persist audit records immutably.
3. Pass `tests/conformance/` to claim compatibility.

## 5. Future processing improvements (post-v0.1.0)

These are explicitly **not** in v0.1.0 scope. Captured here so contributors do not re-derive them.

- **Streaming intent enrichment** — an LLM classifier ahead of the owner that tags intents with spam/anomaly/risk scores, lowering owner review burden.
- **Batched fetches** — `fetch_many([(key, intent), …])` with a single owner approval to combat approval fatigue on multi-step agent runs.
- **Local approval cache** — TTL'd cache keyed on `(agent_id, key_name, intent_hash, policy)` so identical re-fetches in a session skip the round trip when policy permits.
- **Push channel** — WebSocket or SSE alternative to HTTP polling, cutting latency from `poll_interval` to ~ms.
- **Capability tokens** — short-lived, narrowly-scoped derived credentials (eg AWS STS, scoped DB users) where the downstream supports it, so the SDK never holds the raw secret at all.
- **Sidecar mode** — SDK runs as a local daemon; agents talk to it over a Unix socket; enables cross-process pause/resume, a shared nonce ledger, and a single auth surface for multi-agent stacks.
- **Hardware-backed key storage** — TPM/Secure Enclave for the `AUTHORYXOS_API_KEY` itself.
- **Federated audit** — sign audit records with a transparency-log style append-only Merkle tree.

## 6. Integration backlog

Prioritized by ecosystem reach × plugin-interface stability × secret-handling surface area.

1. **OpenClaw** — phase 4.
2. **Claude Code MCP** — already-standardized protocol, low integration cost.
3. **Hermes Agent**.
4. **LangChain** — `Tool` and `Runnable` adapters.
5. **LlamaIndex** — tool integration via `BaseTool`.
6. **AutoGen** — agent-config-level provider.
7. **CrewAI** — `Tool` wrapper.

## 7. Conformance test suite

`tests/conformance/` is a pytest module that any backend (mock or hosted) can run against itself. It covers:

- Happy-path approve.
- Replay rejection.
- Clock-skew rejection.
- Pending → approve transition.
- Pending → deny transition.
- Expiry behavior.
- Audit record shape and required fields.

A backend that passes all cases may claim Authoryx-protocol-compatible.
