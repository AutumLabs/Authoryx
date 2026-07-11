# AuthoryxOS Protocol Specification — v1

This document is the contract between any AuthoryxOS SDK and any
Authoryx-compatible backend. JSON Schemas mirroring the shapes below
live in `packages/protocol/`.

## 1. Transport

- HTTPS only in production; plain HTTP allowed for the mock backend on `localhost`.
- Content type: `application/json; charset=utf-8`.
- All requests authenticated by `Authorization: Bearer axos_live_…`.
- Path prefix: `/v1/`. Minor additive changes only within a major.

## 2. Endpoints

| Method | Path                            | Purpose                                |
| ------ | ------------------------------- | -------------------------------------- |
| POST   | `/v1/os/secrets/:key_name`      | Submit an intent request for a secret. |
| GET    | `/v1/os/pending/:token`         | Poll the state of a pending request.   |
| POST   | `/v1/os/decisions/:token`       | Owner approve/deny (mock only).        |
| GET    | `/v1/os/audit`                  | Read the audit log.                    |

## 3. Request and response schemas

### 3.1 Intent request (`POST /v1/os/secrets/:key_name`)

```json
{
  "api_key": "axos_live_xxxxxxxxxxxxxx",
  "key_name": "PROD_DB_PASSWORD",
  "intent": "Querying the orders table to generate monthly billing summary for user 4821.",
  "agent_id": "openclaw-instance-abc123",
  "session_id": "session-xyz789",
  "nonce": "a3f8b2c1d4e5",
  "timestamp": "2025-01-15T14:32:00Z",
  "policy_hint": "approve_once"
}
```

Field rules:

- `api_key` — `axos_live_[A-Za-z0-9]{20,}`. Validated client-side and server-side.
- `key_name` — `[A-Z][A-Z0-9_]{0,127}`.
- `intent` — 1–4096 chars, free text.
- `agent_id`, `session_id` — opaque, ≤128 chars.
- `nonce` — 24 hex chars (96 bits); single-use.
- `timestamp` — RFC 3339 UTC; rejected if skew >5 min from server clock.
- `policy_hint` — one of `approve_once` (default), `always_approve`, `require_approval`. Backend may ignore.

### 3.2 Approved response

```json
{
  "status": "approved",
  "token": "pending_abc123",
  "secret": "the-actual-secret-value",
  "decision_by": "owner",
  "decided_at": "2025-01-15T14:35:22Z",
  "audit_id": "audit_789xyz"
}
```

### 3.3 Pending response

```json
{
  "status": "pending",
  "token": "pending_abc123",
  "poll_url": "/v1/os/pending/pending_abc123",
  "poll_interval_seconds": 5,
  "expires_at": "2025-01-15T15:32:00Z"
}
```

### 3.4 Denied response

```json
{
  "status": "denied",
  "token": "pending_abc123",
  "reason": "Intent did not match expected agent behavior.",
  "decided_at": "2025-01-15T14:36:01Z",
  "audit_id": "audit_790xyz"
}
```

### 3.5 Audit record

```json
{
  "audit_id": "audit_789xyz",
  "agent_id": "openclaw-instance-abc123",
  "session_id": "session-xyz789",
  "key_name": "PROD_DB_PASSWORD",
  "intent": "Querying the orders table...",
  "decision": "approved",
  "decided_by": "owner",
  "requested_at": "2025-01-15T14:32:00Z",
  "decided_at": "2025-01-15T14:35:22Z",
  "ip_address": "203.0.113.42",
  "nonce": "a3f8b2c1d4e5"
}
```

## 4. PENDING token

- Opaque, URL-safe, ≥128 bits of entropy, prefixed `pending_`.
- Single-use for `POST /v1/os/decisions/:token`.
- Pollable until `expires_at` (default now + 1h).

## 5. Nonce and clock

- Nonce is 96-bit hex, single-use per `api_key`.
- Backend stores `(api_key, nonce)` for ≥10 min after the request `timestamp`.
- Replays return `replayed_nonce`.
- Requests with `|now - timestamp| > 5 min` return `clock_skew`.

## 6. Error envelope

```json
{
  "error": {
    "code": "replayed_nonce",
    "message": "This nonce has already been used.",
    "retryable": false
  }
}
```

| Code              | HTTP | Retryable | Notes                              |
| ----------------- | ---- | --------- | ---------------------------------- |
| `invalid_api_key` | 401  | no        | Format or unknown key.             |
| `invalid_intent`  | 400  | no        | Missing or out-of-bounds intent.   |
| `replayed_nonce`  | 400  | no        | Single-use nonce was reused.       |
| `clock_skew`      | 400  | no        | Timestamp skew >5 min.             |
| `unknown_key`     | 404  | no        | `key_name` not configured.         |
| `expired_token`   | 410  | no        | Pending token past `expires_at`.   |
| `denied`          | 403  | no        | Owner explicitly denied.           |
| `forbidden`       | 403  | no        | API key lacks scope for this op.   |
| `rate_limited`    | 429  | yes       | Backoff per `Retry-After`.         |
| `internal`        | 500  | yes       | Server-side fault.                 |

## 7. Policy hints

| Hint                | Meaning                                                                  |
| ------------------- | ------------------------------------------------------------------------ |
| `approve_once`      | Default. Owner approves this single fetch.                               |
| `always_approve`    | Request a standing approval for this `(agent_id, key_name, intent_hash)`. |
| `require_approval`  | Force the human-in-the-loop path even if a standing approval exists.     |

Backends SHOULD surface the effective decision policy in the response via
the optional `effective_policy` field (one of the three hint values). The
agent-facing SDKs treat it as advisory and ignore it if absent.

## 8. Versioning

- Path prefix `/v1/`.
- Within `v1`, only additive, backward-compatible changes.
- Breaking changes mint `/v2/` and ship a deprecation window.

## 9. Conformance

A backend is Authoryx-protocol-compatible if it passes the
conformance suite at `tests/conformance/`.

## 10. API-key scopes

Every `axos_live_…` key has a scope:

| Scope   | May call                                                             |
| ------- | ------------------------------------------------------------------- |
| `agent` | The agent plane only: `POST /v1/os/secrets/:key`, `GET /v1/os/pending/:token`. |
| `admin` | The agent plane **plus** the admin management plane (§11).           |

An `agent`-scoped key calling an admin endpoint returns `forbidden` (403).
Keys are also optionally restricted to a set of `allowed_keys`; fetching a
`key_name` outside that set returns `unknown_key` (404) — the backend does
not reveal whether the key exists but is out of scope.

## 11. Admin management plane (v1, additive)

These endpoints are **additive within v1** and do not affect the frozen
agent plane (§2). All require an `admin`-scoped bearer key. Schemas live in
`packages/protocol/admin-*.schema.json`.

| Method | Path                       | Purpose                                   | Body / Response schema            |
| ------ | -------------------------- | ----------------------------------------- | --------------------------------- |
| POST   | `/v1/admin/keys`           | Create or replace a stored secret.        | `admin-secret-upsert`             |
| GET    | `/v1/admin/keys`           | List secret **names** (never values).     | `{ keys: [{key_name, description, default_policy, updated_at}] }` |
| DELETE | `/v1/admin/keys/:key_name` | Remove a stored secret.                   | `204`                             |
| POST   | `/v1/admin/agents`         | Register an agent + scope.                | `admin-agent`                     |
| GET    | `/v1/admin/agents`         | List registered agents.                   | `{ agents: [...] }`               |
| POST   | `/v1/admin/api-keys`       | Issue a new API key (plaintext once).     | `admin-api-key`                   |
| GET    | `/v1/admin/api-keys`       | List API-key metadata (no plaintext).     | `{ api_keys: [...] }`             |
| POST   | `/v1/admin/api-keys/:id/revoke` | Revoke a key.                        | `200`                             |

Notes:

- Stored secret **values are never returned** by any admin endpoint; they
  leave the backend only through the approved agent-fetch flow (§3.2).
- `POST /v1/admin/keys` is what the `authoryxos migrate` CLI calls to move a
  hardcoded secret server-side before rewriting the source.
