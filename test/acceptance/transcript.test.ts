/**
 * The acceptance run (FR-001, FR-011, FR-022; AC-002, AC-059).
 *
 * Starts the built MCP server and command-line tool as real processes against
 * the stand-in API, with a planted value of every secret type and a planted
 * agent key, and drives every MCP tool, every command-line verb but `fetch`,
 * every error path and the debug log. Everything an agent could see is kept
 * and searched for each planted value in plain, base64, hex, URL-encoded and
 * JSON-escaped form. A failure names the tool and the encoding.
 *
 * Run after `npm run build`: npm run test:acceptance
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { startFakeApi, type FakeApi } from "@authoryx/fake-agent-api";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const MCP = `${ROOT}packages/mcp/dist/main.js`;
const CLI = `${ROOT}packages/cli/dist/main.js`;
const node = process.execPath;

let api: FakeApi;
let env: Record<string, string>;
const seen: { where: string; text: string }[] = [];
const keep = (where: string, text: unknown) => seen.push({ where, text: typeof text === "string" ? text : JSON.stringify(text) });

function encodings(v: string): Record<string, string> {
  return {
    plain: v,
    base64: Buffer.from(v).toString("base64"),
    "base64 unpadded": Buffer.from(v).toString("base64").replace(/=+$/, ""),
    hex: Buffer.from(v).toString("hex"),
    "url-encoded": encodeURIComponent(v),
    "json-escaped": JSON.stringify(v).slice(1, -1),
  };
}

function cli(args: string[], extraEnv: Record<string, string> = {}): Promise<{ code: number | null; out: string; err: string }> {
  return new Promise((resolve) => {
    const p = spawn(node, [CLI, ...args], { env: { ...process.env, ...env, ...extraEnv }, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => resolve({ code, out, err }));
  });
}

describe("acceptance: nothing planted reaches what an agent sees", () => {
  let mcp: Client;
  let mcpStderr = "";

  before(async () => {
    api = await startFakeApi();
    env = { AUTHORYX_AGENT_ID: api.agentId, AUTHORYX_AGENT_KEY: api.agentKey, AUTHORYX_API_URL: api.url, AUTHORYX_DEBUG: "1" };
    const transport = new StdioClientTransport({ command: node, args: [MCP], env: { ...(process.env as Record<string, string>), ...env }, stderr: "pipe" });
    transport.stderr?.on("data", (d) => (mcpStderr += d));
    mcp = new Client({ name: "acceptance", version: "0" });
    await mcp.connect(transport);
  });

  after(async () => {
    await mcp.close();
    await api.close();
  });

  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await mcp.callTool({ name, arguments: args });
    keep(`MCP ${name}`, r);
    return r as { isError?: boolean; structuredContent?: Record<string, unknown> };
  };

  it("drives every MCP tool, success and error paths", async () => {
    keep("MCP tools/list", await mcp.listTools());
    await call("authoryx_whoami");
    await call("authoryx_list_circles");
    await call("authoryx_list_secrets", { circle: "Deploy" });
    await call("authoryx_list_secrets", { circle: "No such circle" });
    const keys = api.circles[0]!.secrets.map((s) => s.keyName);
    const pending = await call("authoryx_request_access", { circle: "Deploy", keys, reason: "acceptance" });
    const id = pending.structuredContent?.requestId as string;
    await call("authoryx_run", { requestId: id, keys, command: [node, "-e", "1"] });
    await call("authoryx_check_request", { requestId: id, wait: 0 });
    api.approve(id);
    await call("authoryx_check_request", { requestId: id, wait: 1 });
    // A program that prints every value in every encoding, to stdout and stderr, split across writes.
    const leak = `
      const vals = Object.entries(process.env).filter(([k]) => /^(API_TOKEN|GH_LOGIN_PASSWORD|OTP|NOTE)$/.test(k)).map(([,v]) => v);
      for (const v of vals) {
        for (const f of [v, Buffer.from(v).toString('base64'), Buffer.from(v).toString('hex'), encodeURIComponent(v), JSON.stringify(v).slice(1,-1)]) {
          process.stdout.write(f.slice(0, 3)); process.stdout.write(f.slice(3) + '\\n'); process.stderr.write(f + '\\n');
        }
      }
      console.log(JSON.stringify({ vals }));`;
    const ran = await call("authoryx_run", { requestId: id, keys, command: [node, "-e", leak] });
    assert.equal(ran.structuredContent?.exitCode, 0);
    assert.ok((ran.structuredContent?.redactions as number) >= 4 * 5 * 2);
    await call("authoryx_run", { requestId: id, keys, command: ["authoryx-no-such-program"] });
    await call("authoryx_fetch", { key: "API_TOKEN", requestId: id });
    await call("authoryx_close_request", { requestId: id });
    await call("authoryx_run", { requestId: id, keys, command: [node, "-e", "1"] });
    api.setOff(true);
    await call("authoryx_list_circles");
    api.setOff(false);
  });

  it("drives every command-line verb but fetch, and its error paths", async () => {
    const keys = api.circles[0]!.secrets.map((s) => s.keyName);
    for (const args of [["whoami"], ["circles"], ["secrets", "Deploy"], ["secrets", "nope"], ["doctor"], ["--help"]]) {
      const r = await cli(args);
      keep(`CLI ${args.join(" ")} (stdout)`, r.out);
      keep(`CLI ${args.join(" ")} (stderr)`, r.err);
    }
    api.setAutoApprove(true);
    const req = await cli(["request", "Deploy", ...keys, "--reason", "acceptance cli", "--json"]);
    keep("CLI request", req.out + req.err);
    const id = JSON.parse(req.out).requestId as string;
    const st = await cli(["status", id, "--json"]);
    keep("CLI status", st.out + st.err);
    const leak = `for (const k of ['API_TOKEN','GH_LOGIN_PASSWORD','OTP','NOTE']) { const v = process.env[k]; console.log(v, Buffer.from(v).toString('base64'), Buffer.from(v).toString('hex'), encodeURIComponent(v)); console.error(JSON.stringify(v)); }`;
    for (const json of [[], ["--json"]]) {
      const r = await cli(["run", "--request", id, ...keys.flatMap((k) => ["--key", k]), ...json, "--", node, "-e", leak]);
      assert.equal(r.code, 0, r.err);
      keep(`CLI run ${json.join("")} (stdout)`, r.out);
      keep(`CLI run ${json.join("")} (stderr)`, r.err);
    }
    const close = await cli(["close", id]);
    keep("CLI close", close.out + close.err);
    const after = await cli(["run", "--request", id, "--key", "NOTE", "--", node, "-e", "1"]);
    keep("CLI run after close", after.out + after.err);
    const bad = await cli(["circles"], { AUTHORYX_AGENT_KEY: "axa_" + "Q".repeat(43) });
    keep("CLI refused sign-in", bad.out + bad.err);
    api.setAutoApprove(false);
  });

  it("finds no planted value or agent key anywhere, in any encoding", () => {
    keep("MCP server stderr (debug log)", mcpStderr);
    assert.match(mcpStderr, /authoryx: GET \/whoami 200/);
    const planted: [string, string][] = [["agent key", api.agentKey]];
    for (const s of api.circles[0]!.secrets) planted.push([s.keyName, s.value]);
    const leaks: string[] = [];
    for (const [name, value] of planted) {
      for (const [enc, form] of Object.entries(encodings(value))) {
        for (const s of seen) if (s.text.includes(form)) leaks.push(`${s.where}: ${name} (${enc})`);
      }
    }
    assert.deepEqual(leaks, []);
    assert.ok(seen.length > 25);
  });
});
