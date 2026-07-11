# authoryxos-hermes

Hermes Agent plugin that delegates secret access to AuthoryxOS.
Structurally a sibling of `plugins/openclaw/` and `plugins/claude-code/`
— same `runtime` / `tool` / `fetch_secret` semantics, exposed through
Hermes's `tools.registry` instead of OpenClaw's manifest or MCP's
stdio transport.

## Install

```bash
pip install authoryxos-hermes
```

## Configure

```bash
export AUTHORYXOS_API_KEY=axos_live_xxxxxxxxxxxxxxxxxxxx
# Optional — point at a self-hosted backend or the local mock backend:
export AUTHORYXOS_BASE_URL=http://localhost:8787
```

## Register the tool with Hermes

Hermes discovers tools by AST-scanning its own `tools/` directory, so
external packages need to opt in explicitly. Anywhere during Hermes
startup (a `hermes_bootstrap.py` hook, a custom entrypoint, your own
agent loader), call:

```python
import authoryxos_hermes
authoryxos_hermes.register()
```

`register()` is idempotent. It returns `False` (and is a no-op) when
Hermes is not importable — the handler and schema remain usable
directly via the package exports.

## Tool exposed

| Tool                       | Inputs           | What it does                                                    |
| -------------------------- | ---------------- | --------------------------------------------------------------- |
| `authoryxos_fetch_secret`  | `key`, `intent`  | Submits the intent, waits for approval, returns the secret value. |

The `intent` argument is mandatory. AuthoryxOS uses it to populate the
owner's approval dashboard. On denial the tool returns `{"ok": false,
"error": {...}}` rather than raising — the agent reads it and decides
how to proceed.

## Embedding outside Hermes

You can import the pieces directly without going through `register()`:

```python
from authoryxos_hermes import NAME, DESCRIPTION, SCHEMA, handler

# handler is an async function: await handler({"key": "...", "intent": "..."})
```

This is the same shape used by the OpenClaw and Claude Code plugins,
making it easy to retarget to LangChain, LlamaIndex, AutoGen, CrewAI,
or any other framework with a tool-handler abstraction.

## v0.1.0 scope

- Single tool: `authoryxos_fetch_secret`.
- Lazy singleton `AsyncClient` configured from `AUTHORYXOS_*` env vars.
- Same pause-store (`~/.authoryxos/pause.db`) as the Python and
  TypeScript SDKs — pending requests survive process restarts and are
  resumable across language boundaries.
- Best-effort `hermes.toolsets` entry point in `pyproject.toml` for
  any loader that supports entry-point discovery.
