# Agent API, version 1

The tools in this repository speak this API and nothing else. It is the agent half of the
Authoryx API: an agent signs in with its id and key, lists what is shared with it, asks to use
secrets with a reason, and reads a value only after each secret's owner approves.

Base path: `/agent/v1/os` on the Authoryx API.

## Calls

Headers on every call: `Authoryx-Agent: agt_…` and `Authorization: Bearer axa_…`. Every answer is
`{ success, data }`; a refusal is `{ success: false, data: { error, code } }`. Every answer carries
`Cache-Control: no-store`.

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| GET | `/whoami` | — | `{ agent: { id, name, hostKind }, apiVersion: 1, capabilities? }` |
| GET | `/circles` | — | `{ circles: Circle[] }` |
| GET | `/circles/:circleId/secrets` | — | `{ secrets: Share[], vaults: SharedVault[] }` |
| POST | `/requests` | `{ circleId, keyNames: string[1..10], reason, hint?: 'once' \| '1h' \| 'always' }` | `201 { request: Request }` |
| GET | `/requests/:requestId` | — | `{ request: Request }` |
| POST | `/requests/:requestId/close` | `{ outcome: 'done' \| 'abandoned' \| 'failed' }` | `{ request: Request }` |
| POST | `/requests/:requestId/fetch` | `{ keyName }` | `{ value: Value }` |

`capabilities` is optional and not sent by version 1 today. When present it lists the capability
ids granted to this agent beyond `ask`, `run` and `fetch` (see [capabilities.md](capabilities.md)).

## Types

The JSON Schemas in [schemas/](schemas/) are the exact shapes; this is the summary.

```ts
interface Circle { id: string; name: string; description: string | null }
interface Share {
  keyName: string; name: string; type: 'login' | 'api_key' | 'totp' | 'note'; description: string | null;
  vault: { name: string; description: string | null } | null;
  access: { state: 'ask'; pendingRequestId?: string }
        | { state: 'allowed'; until: string; requestId: string }
        | { state: 'blocked' };
}
interface SharedVault { name: string; description: string | null }
interface Request {
  id: string; circleId: string; state: 'pending' | 'approved' | 'denied' | 'expired' | 'closed';
  reason: string; hint: 'once' | '1h' | 'always' | null;
  createdAt: string; expiresAt: string;
  usableUntil: string | null; closedAt: string | null; outcome: string | null;
  items: { keyName: string; state: 'pending' | 'approved' | 'denied' | 'expired'; usableUntil: string | null }[];
  awaiting: { label: string; keyNames: string[] }[];
  approvalUrl: string;
}
type Value =
  | { keyName: string; type: 'login'; username: string | null; password: string; url: string | null; version: number }
  | { keyName: string; type: 'api_key' | 'note'; value: string; version: number }
  | { keyName: string; type: 'totp'; code: string; expiresAt: string; version: number };
```

## Refusals

| Status | Code | When |
| --- | --- | --- |
| 400 | `AGENT_INVALID` | the body or an id fails validation, or the body has an unknown field |
| 401 | `AGENT_UNAUTHORIZED` | any refused sign-in (one answer for every reason) |
| 403 | `AGENT_NOT_APPROVED` | a fetch of an item that is pending, denied, expired or past its use time, or of a closed request; `data.state` says which |
| 404 | `AGENT_NOT_FOUND` | anything out of the agent's reach (one answer for every reason) |
| 429 | `AGENT_PENDING_LIMIT` | a sixth request waiting for an answer |
| 429 | `RATE_LIMIT_EXCEEDED` | more than 120 calls a minute, or too many refused sign-ins; `RateLimit-Reset` says when to retry |
| 503 | `AGENT_API_OFF` | the agent API is switched off |
| 503 | `AGENT_UNAVAILABLE` | the call could not be completed; try again |

## Limits

120 calls a minute per agent. Five requests waiting for an answer per agent. A request waits five
minutes for its answer; an approved item can be used for fifteen minutes.
