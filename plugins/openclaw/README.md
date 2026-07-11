# @authoryxos/openclaw-plugin

OpenClaw plugin that delegates secret access to AuthoryxOS. Modeled on the
[`supermemoryai/openclaw-supermemory`](https://github.com/supermemoryai/openclaw-supermemory)
plugin shape: a `openclaw.plugin.json` manifest, hooks for the OpenClaw
lifecycle, and a tool that the agent calls at runtime.

## Install

```bash
openclaw plugins install @authoryxos/openclaw-plugin
```

## Configure

```bash
export AUTHORYXOS_API_KEY=axos_live_xxxxxxxxxxxxxxxxxxxx
# Optional — point at a self-hosted backend or the local mock backend:
export AUTHORYXOS_BASE_URL=http://localhost:8787
```

## What the agent gets

A single tool:

| Tool                       | Inputs           | What it does                                   |
| -------------------------- | ---------------- | ---------------------------------------------- |
| `authoryxos_fetch_secret`  | `key`, `intent`  | Submits the intent, waits for approval, returns the secret value. |

The `intent` string is mandatory. It is what the owner reads in the
Authoryx dashboard to approve or deny the fetch.

## Architecture

```
agent  ──tool call──▶  authoryxos_fetch_secret
                              │
                              ▼
                  authoryxos.Client.fetch()        (TypeScript SDK)
                              │
                              ▼
                AuthoryxOS protocol over HTTPS
                              │
                              ▼
                  Authoryx-compatible backend
```

## v0.1.0 scope

- Loads config via `onAgentStart` hook + env vars.
- Exposes the `authoryxos_fetch_secret` tool.
- Lazy singleton `Client` for the duration of the agent session.
- `onToolCall` hook is reserved for future enforcement (refusing tool
  calls whose args look like leaked secrets).
