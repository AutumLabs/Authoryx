/**
 * The Authoryx MCP server (FR-001). A stdio server over the core's registry:
 * it lists the tools the platform grants this agent on the MCP surface (seven
 * with no extra capabilities) and calls them. No tool returns a value (ADR-0012);
 * `fetch` is not an MCP tool.
 *
 * Sign-in is resolved on first use, so the server starts and answers a tool
 * list before any agent is signed in; a call then returns the sign-in sentence.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import {
  VERSION,
  callTool,
  connect,
  defaultRegistry,
  toToolError,
  type ConnectOptions,
  type RequestView,
  type RunResult,
  type ToolContext,
  type ToolDef,
} from "@authoryx/core";

export const INSTRUCTIONS = [
  "Authoryx lets you use secrets that people share with you, after the secret's owner approves.",
  "1. authoryx_list_circles, then authoryx_list_secrets to see key names (never values).",
  "2. authoryx_request_access with a clear reason. While it is pending, show your person the approvalUrl and call authoryx_check_request with wait.",
  "3. authoryx_run runs a program with the approved secrets as environment variables named by key; you get the exit code and the output with values removed.",
  "4. authoryx_close_request when the work is done.",
  "Never try to print or read a secret's value: no tool returns one, and the person sees every request in their Log.",
].join("\n");

export interface ServerOptions extends Partial<Omit<ConnectOptions, "surface" | "product">> {
  /** Replaces sign-in for tests. */
  context?: () => Promise<ToolContext>;
}

/** Short lines for the text block; the same data is in structuredContent. */
function summary(tool: ToolDef, out: unknown): string {
  const o = out as Record<string, unknown>;
  if (o && "next" in o && "requestId" in o) {
    const v = o as unknown as RequestView;
    return [
      `Request ${v.requestId}: ${v.state}.`,
      ...v.items.map((i) => `${i.key}: ${i.state}${i.usableForSeconds !== null ? `, usable for ${i.usableForSeconds}s` : ""}`),
      ...(v.approvalUrl ? [`Approval link: ${v.approvalUrl}`] : []),
      v.next,
    ].join("\n");
  }
  if (o && o.ran === true) {
    const r = o as unknown as RunResult;
    return [
      `Exit code ${r.exitCode ?? `none (signal ${r.signal})`}${r.timedOut ? ", stopped at the timeout" : ""}. ${r.redactions} value${r.redactions === 1 ? "" : "s"} removed.`,
      ...(r.note ? [r.note] : []),
      "Output:",
      r.output,
    ].join("\n");
  }
  return `${tool.name}:\n${JSON.stringify(out, null, 2)}`;
}

export function createServer(opts: ServerOptions = {}): Server {
  const registry = defaultRegistry();
  let ctx: Promise<ToolContext> | null = null;
  const context = () => {
    ctx ??= (opts.context ?? (() => connect({ ...opts, surface: "mcp", product: "mcp" })))().catch((e) => {
      ctx = null; // try again on the next call, e.g. after `authoryx login`
      throw e;
    });
    return ctx;
  };

  const server = new Server({ name: "authoryx", version: VERSION }, { capabilities: { tools: {} }, instructions: INSTRUCTIONS });

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    let whoami: ToolContext["whoami"] | Record<string, never> = {};
    try {
      whoami = (await context()).whoami;
    } catch {
      /* not signed in yet: list what every agent is granted */
    }
    return {
      tools: registry.toolsFor("mcp", whoami).map((t) => ({
        name: t.name,
        description: `${t.summary} Returns ${t.returns}; never ${t.never}.`,
        inputSchema: t.input as { type: "object" },
      })),
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const name = req.params.name;
    try {
      const c = await context();
      const tool = registry.find("mcp", c.whoami, name);
      if (!tool) return { isError: true, content: [{ type: "text", text: `Unknown tool ${name}.` }], structuredContent: { code: "AUTHORYX_UNKNOWN_TOOL", message: `Unknown tool ${name}.` } };
      const out = await callTool(tool, c, req.params.arguments ?? {});
      return { content: [{ type: "text", text: summary(tool, out) }], structuredContent: out as Record<string, unknown> };
    } catch (e) {
      const t = toToolError(e);
      return { isError: true, content: [{ type: "text", text: t.message }], structuredContent: t.toJSON() };
    }
  });

  return server;
}
