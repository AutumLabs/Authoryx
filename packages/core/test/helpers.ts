import { startFakeApi, type FakeApi, type FakeApiOptions } from "@authoryx/fake-agent-api";
import { connect, type ToolContext } from "../src/index.ts";

export async function fixture(opts: FakeApiOptions = {}): Promise<{ api: FakeApi; ctx: () => Promise<ToolContext>; env: NodeJS.ProcessEnv }> {
  const api = await startFakeApi(opts);
  const env = { AUTHORYX_AGENT_ID: api.agentId, AUTHORYX_AGENT_KEY: api.agentKey, AUTHORYX_API_URL: api.url };
  return { api, env, ctx: () => connect({ surface: "mcp", product: "mcp", env, pollMs: 20 }) };
}
