#!/usr/bin/env node
/**
 * stdio MCP server. Run via:
 *
 *   AUTHORYXOS_API_KEY=axos_live_... npx authoryxos-mcp
 *
 * Or register with Claude Code via `.mcp.json`:
 *
 *   {
 *     "mcpServers": {
 *       "authoryxos": {
 *         "command": "npx",
 *         "args": ["-y", "@authoryxos/claude-code-mcp"],
 *         "env": {
 *           "AUTHORYXOS_API_KEY": "axos_live_...",
 *           "AUTHORYXOS_BASE_URL": "http://localhost:8787"
 *         }
 *       }
 *     }
 *   }
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { configure } from "./runtime.js";
import { fetchSecret } from "./tools.js";

export function buildServer(): McpServer {
  const server = new McpServer({
    name: "authoryxos",
    version: "0.1.0",
  });

  server.registerTool(
    "authoryxos_fetch_secret",
    {
      description:
        "Fetch a named secret from AuthoryxOS. The 'intent' field is mandatory — " +
        "describe in plain language why you need the secret. The owner reads it " +
        "to approve or deny the fetch. On denial the tool returns ok=false with " +
        "an error message instead of throwing.",
      inputSchema: {
        key: z
          .string()
          .regex(/^[A-Z][A-Z0-9_]{0,127}$/)
          .describe("SCREAMING_SNAKE_CASE name of the secret to fetch."),
        intent: z
          .string()
          .min(1)
          .max(4096)
          .describe("Plain-language reason this secret is needed right now."),
      },
    },
    async ({ key, intent }) => {
      const result = await fetchSecret({ key, intent });
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        isError: !result.ok,
      };
    },
  );

  return server;
}

export async function main(): Promise<void> {
  const apiKey = process.env["AUTHORYXOS_API_KEY"];
  if (!apiKey) {
    process.stderr.write("AUTHORYXOS_API_KEY is required.\n");
    process.exit(1);
  }
  configure({
    apiKey,
    ...(process.env["AUTHORYXOS_BASE_URL"]
      ? { baseUrl: process.env["AUTHORYXOS_BASE_URL"] }
      : {}),
    ...(process.env["AUTHORYXOS_AGENT_ID"]
      ? { agentId: process.env["AUTHORYXOS_AGENT_ID"] }
      : {}),
    ...(process.env["AUTHORYXOS_SESSION_ID"]
      ? { sessionId: process.env["AUTHORYXOS_SESSION_ID"] }
      : {}),
  });

  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

const isEntrypoint = (() => {
  try {
    const argv1 = process.argv[1];
    if (!argv1) return false;
    return import.meta.url === new URL(`file://${argv1}`).href;
  } catch {
    return false;
  }
})();

if (isEntrypoint) {
  main().catch((e) => {
    process.stderr.write(`fatal: ${(e as Error).message}\n`);
    process.exit(1);
  });
}
