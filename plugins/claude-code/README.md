# @authoryxos/claude-code-mcp

[MCP](https://docs.claude.ai/en/docs/claude-code/mcp) server that lets
Claude Code fetch secrets through AuthoryxOS — one API key per agent,
intent declarations on every fetch, human-in-the-loop approval with
pause/resume.

Structurally a sibling of `plugins/openclaw/`: same `runtime.ts`,
`tools.ts`, and `fetchSecret` semantics, exposed over stdio MCP
instead of OpenClaw's in-process plugin interface.

## Install

```bash
npm install -g @authoryxos/claude-code-mcp
```

## Register with Claude Code

Add to your `.mcp.json`:

```json
{
  "mcpServers": {
    "authoryxos": {
      "command": "npx",
      "args": ["-y", "@authoryxos/claude-code-mcp"],
      "env": {
        "AUTHORYXOS_API_KEY": "axos_live_xxxxxxxxxxxxxxxxxxxx",
        "AUTHORYXOS_BASE_URL": "http://localhost:8787"
      }
    }
  }
}
```

`AUTHORYXOS_BASE_URL` defaults to `https://api.authoryx.dev`. Point at
the local mock backend (`http://localhost:8787`) during development.

## Tool exposed

| Tool                       | Inputs           | What it does                                                    |
| -------------------------- | ---------------- | --------------------------------------------------------------- |
| `authoryxos_fetch_secret`  | `key`, `intent`  | Submits the intent, waits for approval, returns the secret value. |

The `intent` argument is mandatory. AuthoryxOS uses it to populate the
owner's approval dashboard. On denial the tool returns `ok: false`
with a structured error rather than throwing — Claude Code reads it
and decides how to proceed.

## Skill

`skill/SKILL.md` is the agent-facing skill that teaches the model *when*
and *how* to use this tool: never hardcode or read secrets from env/files,
always fetch with a specific `intent`, hold the value only for the immediate
operation, and never log it. Install it as a Claude Code skill (or copy it
into your project's skills directory) alongside registering the MCP server
above so the model reaches for `authoryxos_fetch_secret` instead of
inventing or hardcoding credentials.

## v0.1.0 scope

- stdio MCP server (`authoryxos-mcp` binary).
- One tool: `authoryxos_fetch_secret`.
- Lazy singleton `Client` for the lifetime of the MCP session.
- Same pause-store (`~/.authoryxos/pause.db`) as the Python and
  TypeScript SDKs — pending requests survive process restarts and
  are resumable across language boundaries.
