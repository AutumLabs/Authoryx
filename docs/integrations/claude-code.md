# Claude Code (MCP) integration

AuthoryxOS exposes an MCP server (`@authoryxos/claude-code-mcp`,
binary `authoryxos-mcp`) that Claude Code connects to over stdio.

Register it in your `.mcp.json`:

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

Tool exposed: `authoryxos_fetch_secret({ key, intent })`. The MCP
server shares its `Client`, error taxonomy, and pause store with the
TypeScript SDK in `packages/sdk-typescript/` and the OpenClaw plugin
in `plugins/openclaw/`.

See `plugins/claude-code/README.md` and the MCP docs at
<https://docs.claude.ai/en/docs/claude-code/mcp>.
