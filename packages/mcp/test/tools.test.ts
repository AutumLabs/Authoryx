import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { startFakeApi, newAgentKey, type FakeApi } from "@authoryx/fake-agent-api";
import { connect, PENDING_NEXT, memoryKeyStore } from "@authoryx/core";
import { createServer, type ServerOptions } from "../src/index.ts";

let api: FakeApi;
const node = process.execPath;

async function client(opts: ServerOptions) {
  const [a, b] = InMemoryTransport.createLinkedPair();
  const c = new Client({ name: "test", version: "0" });
  await Promise.all([createServer(opts).connect(a), c.connect(b)]);
  return c;
}
const envOf = (key = api.agentKey) => ({ AUTHORYX_AGENT_ID: api.agentId, AUTHORYX_AGENT_KEY: key, AUTHORYX_API_URL: api.url });
const signedIn = () => client({ env: envOf(), pollMs: 20 });

type Result = { isError?: boolean; structuredContent?: Record<string, unknown>; content: { type: string; text: string }[] };
const call = async (c: Client, name: string, args: Record<string, unknown> = {}) => (await c.callTool({ name, arguments: args })) as Result;

describe("the MCP server (FR-001)", () => {
  before(async () => {
    api = await startFakeApi();
  });
  after(() => api.close());

  it("lists exactly the seven tools for an agent with no extra capabilities, none of them fetch", async () => {
    const c = await signedIn();
    const { tools } = await c.listTools();
    assert.deepEqual(tools.map((t) => t.name), [
      "authoryx_whoami",
      "authoryx_list_circles",
      "authoryx_list_secrets",
      "authoryx_request_access",
      "authoryx_check_request",
      "authoryx_run",
      "authoryx_close_request",
    ]);
    for (const t of tools) assert.match(t.description ?? "", /never/);
  });

  it("answers a tool list before any agent is signed in", async () => {
    const c = await client({ env: {}, store: memoryKeyStore(), settingsFile: "/nonexistent/authoryx/config.json" });
    assert.equal((await c.listTools()).tools.length, 7);
    const r = await call(c, "authoryx_whoami");
    assert.equal(r.isError, true);
    assert.match(r.content[0]!.text, /No agent is signed in/);
  });

  it("whoami returns the agent, the API and the key source, never the key", async () => {
    const r = await call(await signedIn(), "authoryx_whoami");
    assert.equal((r.structuredContent?.agent as { id: string }).id, api.agentId);
    assert.deepEqual(r.structuredContent?.api, { url: api.url, version: 1 });
    assert.ok(!JSON.stringify(r).includes(api.agentKey));
  });

  it("each tool returns structured content and the same data as text", async () => {
    const c = await signedIn();
    const circles = await call(c, "authoryx_list_circles");
    assert.ok(Array.isArray(circles.structuredContent?.circles));
    const secrets = await call(c, "authoryx_list_secrets", { circle: "Deploy" });
    assert.equal((secrets.structuredContent?.secrets as unknown[]).length, 4);
    const pending = await call(c, "authoryx_request_access", { circle: "Deploy", keys: ["API_TOKEN"], reason: "mcp test" });
    assert.equal(pending.structuredContent?.state, "pending");
    assert.match(pending.content[0]!.text, /Approval link: https:\/\//);
    assert.ok(pending.content[0]!.text.includes(PENDING_NEXT));
    const id = pending.structuredContent?.requestId as string;
    api.approve(id);
    const checked = await call(c, "authoryx_check_request", { requestId: id, wait: 1 });
    assert.equal(checked.structuredContent?.state, "approved");
    const ran = await call(c, "authoryx_run", { requestId: id, keys: ["API_TOKEN"], command: [node, "-e", "console.log(process.env.API_TOKEN)"] });
    assert.equal(ran.structuredContent?.exitCode, 0);
    assert.match(ran.content[0]!.text, /1 value removed/);
    assert.ok(!JSON.stringify(ran).includes(api.circles[0]!.secrets[0]!.value));
    const closed = await call(c, "authoryx_close_request", { requestId: id });
    assert.equal(closed.structuredContent?.state, "closed");
  });

  it("refuses a tool that is not granted, fetch included, as unknown", async () => {
    const c = await signedIn();
    for (const name of ["authoryx_fetch", "authoryx_web_signin"]) {
      const r = await call(c, name, { key: "API_TOKEN" });
      assert.equal(r.isError, true);
      assert.equal(r.content[0]!.text, `Unknown tool ${name}.`);
    }
  });

  it("a granted capability the tools do not know changes nothing", async () => {
    api.setCapabilities(["teleport", "web.signin"]);
    const { tools } = await (await signedIn()).listTools();
    api.setCapabilities(undefined);
    assert.equal(tools.length, 7);
  });

  it("a refused sign-in is a tool error with the sentence and no key", async () => {
    const wrong = newAgentKey();
    const c = await client({ env: envOf(wrong) });
    const r = await call(c, "authoryx_list_circles");
    assert.equal(r.isError, true);
    assert.match(r.content[0]!.text, /did not accept this agent's id and key/);
    assert.ok(!JSON.stringify(r).includes(wrong));
  });

  it("a tool error names the key name and the API's code, not the value", async () => {
    const c = await signedIn();
    const p = await call(c, "authoryx_request_access", { circle: "Deploy", keys: ["NOTE"], reason: "deny me" });
    api.deny(p.structuredContent?.requestId as string);
    const r = await call(c, "authoryx_run", { requestId: p.structuredContent?.requestId, keys: ["NOTE"], command: [node, "-v"] });
    assert.equal(r.structuredContent?.state, "denied");
    assert.match(r.content[0]!.text, /NOTE: denied/);
  });

  it("uses an injected context", async () => {
    const ctx = await connect({ surface: "mcp", product: "mcp", env: envOf() });
    const r = await call(await client({ context: async () => ctx }), "authoryx_whoami");
    assert.equal(r.isError, undefined);
  });
});
