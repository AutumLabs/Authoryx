import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AuthoryxError } from "@authoryx/sdk";
import type { FakeApi } from "@authoryx/fake-agent-api";
import {
  EXIT,
  NOT_SIGNED_IN,
  connect,
  memoryKeyStore,
  readSettings,
  resolveSignIn,
  toToolError,
  userAgent,
  VERSION,
  writeSettings,
} from "../src/index.ts";
import { fixture } from "./helpers.ts";

const tmp = () => join(mkdtempSync(join(tmpdir(), "authoryx-")), "authoryx", "config.json");
const err = (kind: AuthoryxError["kind"], code: string, status: number, extra: Partial<AuthoryxError> = {}) =>
  new AuthoryxError({ kind, code, status, message: "API sentence.", ...extra } as never);

describe("sign-in sources (FR-007)", () => {
  it("uses the environment and stores nothing", () => {
    const store = memoryKeyStore();
    const s = resolveSignIn({ env: { AUTHORYX_AGENT_ID: "agt_x", AUTHORYX_AGENT_KEY: "axa_y", AUTHORYX_API_URL: "http://a" }, store, settingsFile: tmp() });
    assert.equal(s.keySource, "environment");
    assert.equal(store.items.size, 0);
  });

  it("reads the keychain item named by the settings file", () => {
    const store = memoryKeyStore();
    const file = tmp();
    writeSettings(file, { apiUrl: "http://a", agentId: "agt_x" });
    store.set("agt_x", "axa_y");
    const s = resolveSignIn({ env: {}, store, settingsFile: file });
    assert.deepEqual(s, { agentId: "agt_x", agentKey: "axa_y", apiUrl: "http://a", keySource: "keychain" });
    assert.deepEqual(readSettings(file), { apiUrl: "http://a", agentId: "agt_x" });
    if (process.platform !== "win32") assert.equal(statSync(file).mode & 0o777, 0o600);
  });

  it("with neither, says no agent is signed in and names the variables", () => {
    assert.throws(() => resolveSignIn({ env: {}, store: memoryKeyStore(), settingsFile: tmp() }), (e: Error & { exit?: number }) => {
      assert.equal(e.message, NOT_SIGNED_IN);
      assert.equal(e.exit, EXIT.unauthorized);
      return true;
    });
  });

  it("refuses half an environment", () => {
    assert.throws(() => resolveSignIn({ env: { AUTHORYX_AGENT_ID: "agt_x" }, settingsFile: tmp() }), /both AUTHORYX_AGENT_ID and AUTHORYX_AGENT_KEY/);
  });
});

describe("sentences and exit statuses (FR-019)", () => {
  const cases: [AuthoryxError, number, RegExp][] = [
    [err("unauthorized", "AGENT_UNAUTHORIZED", 401), EXIT.unauthorized, /did not accept this agent's id and key/],
    [err("not_found", "AGENT_NOT_FOUND", 404), EXIT.notFound, /cannot reach it/],
    [err("not_approved", "AGENT_NOT_APPROVED", 403, { state: "denied" }), EXIT.notApproved, /API_TOKEN: not approved .*denied/],
    [err("pending_limit", "AGENT_PENDING_LIMIT", 429), EXIT.limit, /Wait for an answer/],
    [err("rate_limited", "RATE_LIMIT_EXCEEDED", 429, { retryAfter: 9 }), EXIT.limit, /Try again in 9 seconds/],
    [err("api_off", "AGENT_API_OFF", 503), EXIT.apiOff, /switched off/],
    [err("version_unsupported", "AUTHORYX_VERSION_UNSUPPORTED", 0), EXIT.version, /npm install -g authoryx@latest/],
  ];
  for (const [e, exit, re] of cases) {
    it(`${e.code} → exit ${exit}`, () => {
      const t = toToolError(e, { keyName: "API_TOKEN" });
      assert.equal(t.exit, exit);
      assert.match(t.message, re);
      assert.equal(t.code, e.code);
    });
  }
});

describe("against the stand-in API", () => {
  let f: Awaited<ReturnType<typeof fixture>>;
  let api: FakeApi;
  before(async () => {
    f = await fixture();
    api = f.api;
  });
  after(() => api.close());

  it("calls whoami before any other route", async () => {
    api.calls.length = 0;
    await (await f.ctx()).client.circles();
    assert.deepEqual(api.calls.map((c) => c.path), ["/agent/v1/os/whoami", "/agent/v1/os/circles"]);
  });

  it("stops on an API version it does not support, naming both and the upgrade", async () => {
    api.setApiVersion(7);
    await assert.rejects(f.ctx(), (e: Error & { exit?: number }) => {
      assert.equal(e.exit, EXIT.version);
      assert.match(e.message, /version 7.*supports 1.*npm install -g authoryx@latest/);
      return true;
    });
    api.setApiVersion(1);
  });

  it("sends the surface's user agent", async () => {
    await f.ctx();
    assert.equal(api.calls.at(-1)?.userAgent, userAgent("mcp"));
    assert.equal(userAgent("cli"), `authoryx-cli/${VERSION}`);
  });

  it("waits out a 429 and retries", async () => {
    api.rateLimit(1, 1);
    const ctx = await f.ctx();
    assert.ok((await ctx.client.circles()).length > 0);
  });

  it("debug output has route, status and duration, and no key, header or value", async () => {
    const lines: string[] = [];
    const ctx = await connect({ surface: "cli", product: "cli", env: { ...f.env, AUTHORYX_DEBUG: "1" }, debug: (s) => lines.push(s) });
    api.setAutoApprove(true);
    const circle = api.circles[0]!;
    const r = await ctx.client.request({ circleId: circle.id, keyNames: ["API_TOKEN"], reason: "debug" });
    await ctx.client.fetch(r.id, "API_TOKEN");
    api.setAutoApprove(false);
    const log = lines.join("");
    assert.match(log, /authoryx: GET \/whoami 200 \d+ms/);
    assert.match(log, /authoryx: POST \/requests\/[^ ]+\/fetch 200 \d+ms/);
    for (const banned of [api.agentKey, circle.secrets[0]!.value, "Bearer", "password", "value"]) assert.ok(!log.includes(banned), banned);
  });
});
