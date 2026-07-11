import { configure } from "./runtime.js";

/**
 * `onAgentStart` — invoked by OpenClaw when an agent session boots.
 * Reads config from environment + plugin manifest and wires the SDK.
 */
export function onAgentStart(ctx: {
  config: Record<string, string | undefined>;
  agentId?: string;
  sessionId?: string;
}): void {
  const apiKey = ctx.config["AUTHORYXOS_API_KEY"] ?? process.env["AUTHORYXOS_API_KEY"];
  if (!apiKey) {
    throw new Error(
      "AUTHORYXOS_API_KEY is required. Set it in the OpenClaw plugin config or env.",
    );
  }
  configure({
    apiKey,
    ...(ctx.config["AUTHORYXOS_BASE_URL"] ? { baseUrl: ctx.config["AUTHORYXOS_BASE_URL"] } : {}),
    ...(ctx.agentId ? { agentId: ctx.agentId } : {}),
    ...(ctx.sessionId ? { sessionId: ctx.sessionId } : {}),
  });
}

/**
 * `onToolCall` — invoked before every tool the agent calls.
 *
 * Reserved for future enforcement: refusing tool calls whose arguments
 * appear to contain hardcoded secrets, redirecting them through
 * `authoryxos_fetch_secret` instead. v0.1.0 is a no-op.
 */
export function onToolCall(_ctx: { tool: string; args: unknown }): void {
  /* intentionally empty in v0.1.0 */
}
