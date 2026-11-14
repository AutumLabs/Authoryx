import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { startFakeApi, type FakeApi } from "@authoryx/fake-agent-api";
import { assertSchema } from "@authoryx/fake-agent-api/schemas";
import { Authoryx, AuthoryxError, VERSION } from "../src/index.ts";

let api: FakeApi;
let ax: Authoryx;
let circleId: string;

const client = (over: Partial<ConstructorParameters<typeof Authoryx>[0]> = {}) =>
  new Authoryx({ agentId: api.agentId, agentKey: api.agentKey, apiUrl: api.url, ...over });

async function rejects(p: Promise<unknown>, kind: string, extra: Record<string, unknown> = {}): Promise<AuthoryxError> {
  try {
    await p;
  } catch (e) {
    assert.ok(e instanceof AuthoryxError, `expected AuthoryxError, got ${e}`);
    assert.equal(e.kind, kind);
    for (const [k, v] of Object.entries(extra)) assert.equal((e as unknown as Record<string, unknown>)[k], v);
    return e;
  }
  assert.fail(`expected a ${kind} refusal`);
}

describe("@authoryx/sdk against the stand-in agent API", () => {
  before(async () => {
    api = await startFakeApi();
    ax = client();
    circleId = api.circles[0]!.id;
  });
  after(() => api.close());
  beforeEach(() => {
    api.setAutoApprove(false);
    api.setOff(false);
    api.setApiVersion(1);
  });

  it("whoami returns the agent and the API version", async () => {
    const me = await ax.whoami();
    assertSchema("whoami", me);
    assert.equal(me.agent.id, api.agentId);
    assert.equal(me.apiVersion, 1);
  });

  it("circles and secrets match the contract", async () => {
    const circles = await ax.circles();
    circles.forEach((c) => assertSchema("circle", c));
    assert.equal(circles[0]!.name, "Deploy");
    const { secrets, vaults } = await ax.secrets(circleId);
    secrets.forEach((s) => assertSchema("share", s));
    vaults.forEach((v) => assertSchema("shared-vault", v));
    assert.deepEqual(secrets.map((s) => s.keyName), ["API_TOKEN", "GH_LOGIN", "OTP", "NOTE"]);
    assert.equal(secrets[0]!.access.state, "ask");
  });

  it("request opens a pending request carrying the approval link", async () => {
    const r = await ax.request({ circleId, keyNames: ["API_TOKEN"], reason: "test", hint: "once" });
    assertSchema("request", r);
    assert.equal(r.state, "pending");
    assert.match(r.approvalUrl, new RegExp(`/r/${r.id}$`));
    assert.deepEqual(r.awaiting[0]!.keyNames, ["API_TOKEN"]);
    assert.equal((await ax.getRequest(r.id)).state, "pending");
    await ax.closeRequest(r.id, "abandoned");
  });

  it("waitForRequest returns as soon as the owner answers", async () => {
    const r = await ax.request({ circleId, keyNames: ["API_TOKEN"], reason: "wait" });
    setTimeout(() => api.approve(r.id), 50);
    const t = Date.now();
    const done = await ax.waitForRequest(r.id, { seconds: 5, intervalMs: 20 });
    assert.equal(done.state, "approved");
    assert.ok(Date.now() - t < 2000);
    await ax.closeRequest(r.id, "done");
  });

  it("waitForRequest gives back the pending request when the wait ends", async () => {
    const r = await ax.request({ circleId, keyNames: ["NOTE"], reason: "wait out" });
    const done = await ax.waitForRequest(r.id, { seconds: 0.1, intervalMs: 20 });
    assert.equal(done.state, "pending");
    await ax.closeRequest(r.id, "abandoned");
  });

  it("fetch returns each type's fields once approved", async () => {
    api.setAutoApprove(true);
    const r = await ax.request({ circleId, keyNames: ["API_TOKEN", "GH_LOGIN", "OTP", "NOTE"], reason: "all" });
    assert.equal(r.state, "approved");
    const secrets = api.circles[0]!.secrets;
    for (const s of secrets) {
      const v = await ax.fetch(r.id, s.keyName);
      assertSchema("value", v);
      assert.equal(v.type, s.type);
      if (v.type === "login") {
        assert.equal(v.password, s.value);
        assert.equal(v.username, "release-bot");
      } else if (v.type === "totp") assert.equal(v.code, s.value);
      else assert.equal(v.value, s.value);
    }
    const closed = await ax.closeRequest(r.id, "done");
    assert.equal(closed.state, "closed");
    await rejects(ax.fetch(r.id, "API_TOKEN"), "not_approved", { state: "closed", status: 403 });
  });

  it("not_approved carries the item's state", async () => {
    const r = await ax.request({ circleId, keyNames: ["API_TOKEN", "NOTE"], reason: "states" });
    await rejects(ax.fetch(r.id, "API_TOKEN"), "not_approved", { state: "pending" });
    api.deny(r.id, ["API_TOKEN"]);
    api.approve(r.id, ["NOTE"]);
    await rejects(ax.fetch(r.id, "API_TOKEN"), "not_approved", { state: "denied" });
    api.expireUse(r.id);
    await rejects(ax.fetch(r.id, "NOTE"), "not_approved", { state: "expired" });
  });

  it("refusals map to kinds", async () => {
    await rejects(client({ agentKey: "axa_" + "x".repeat(43) }).circles(), "unauthorized", { status: 401, code: "AGENT_UNAUTHORIZED" });
    await rejects(ax.secrets("00000000-0000-0000-0000-000000000000"), "not_found", { status: 404 });
    await rejects(ax.request({ circleId, keyNames: [], reason: "x" }), "invalid", { field: "keyNames" });
    api.setOff(true);
    await rejects(ax.circles(), "api_off", { status: 503 });
  });

  it("a sixth pending request is refused with pending_limit", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push((await ax.request({ circleId, keyNames: ["OTP"], reason: `p${i}` })).id);
    await rejects(ax.request({ circleId, keyNames: ["OTP"], reason: "sixth" }), "pending_limit", { status: 429 });
    for (const id of ids) await ax.closeRequest(id, "abandoned");
  });

  it("a 429 with a reset is waited out and retried", async () => {
    api.rateLimit(1, 1);
    const t = Date.now();
    const circles = await ax.circles();
    assert.equal(circles.length, 2);
    assert.ok(Date.now() - t >= 900);
  });

  it("a 429 longer than the retry budget is reported", async () => {
    api.rateLimit(1, 5);
    await rejects(client({ maxRetryWaitSeconds: 1 }).circles(), "rate_limited", { retryAfter: 5 });
    api.rateLimit(0, 1);
  });

  it("an unsupported API version stops at whoami", async () => {
    api.setApiVersion(2);
    const e = await rejects(ax.whoami(), "version_unsupported");
    assert.match(e.message, /version 2/);
    assert.match(e.message, /supports 1/);
  });

  it("an unreachable API is a network error", async () => {
    await rejects(client({ apiUrl: "http://127.0.0.1:9" }).circles(), "network");
  });

  it("sends its user agent and nothing about the machine", async () => {
    await ax.circles();
    const last = api.calls.at(-1)!;
    assert.equal(last.userAgent, `authoryx-sdk-ts/${VERSION}`);
    const others = Object.keys(last.headers).filter((h) => !["host", "connection", "authoryx-agent", "authorization", "user-agent", "accept", "accept-encoding", "accept-language", "sec-fetch-mode", "content-type", "content-length"].includes(h));
    assert.deepEqual(others, []);
  });

  it("never serialises the key", () => {
    assert.ok(!JSON.stringify(ax).includes(api.agentKey));
    assert.ok(!JSON.stringify({ ax }).includes("axa_"));
  });
});
