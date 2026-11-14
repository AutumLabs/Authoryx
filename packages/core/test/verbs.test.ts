import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { FakeApi } from "@authoryx/fake-agent-api";
import { callTool, defaultRegistry, EXIT, PENDING_NEXT, type RequestView, type RunResult, type ToolContext } from "../src/index.ts";
import { fixture } from "./helpers.ts";

const reg = defaultRegistry();
const tool = (name: string) => reg.all().find((t) => t.name === name)!;
let api: FakeApi;
let ctx: ToolContext;
const call = <T>(name: string, input: unknown) => callTool(tool(name), ctx, input) as Promise<T>;
const node = process.execPath;

async function refused(p: Promise<unknown>, exit: number, re?: RegExp) {
  await assert.rejects(p, (e: Error & { exit?: number }) => {
    assert.equal(e.exit, exit, e.message);
    if (re) assert.match(e.message, re);
    return true;
  });
}

describe("verbs against the stand-in API", () => {
  before(async () => {
    const f = await fixture({
      circles: undefined,
    });
    api = f.api;
    api.circles.push({ id: randomUUID(), name: "Twin", description: null, secrets: [] }, { id: randomUUID(), name: "twin", description: "second", secrets: [] });
    ctx = await f.ctx();
  });
  after(() => api.close());
  beforeEach(() => api.setAutoApprove(false));

  it("whoami gives the agent, the API and the key source, never the key", async () => {
    const out = await call<Record<string, unknown>>("authoryx_whoami", {});
    assert.deepEqual(out, { agent: { id: api.agentId, name: "Test agent", hostKind: "claude-code" }, api: { url: api.url, version: 1 }, keySource: "environment" });
    assert.ok(!JSON.stringify(out).includes(api.agentKey));
  });

  it("lists circles, and secrets by circle id or name", async () => {
    const { circles } = await call<{ circles: { id: string; name: string }[] }>("authoryx_list_circles", {});
    assert.equal(circles[0]!.name, "Deploy");
    const byName = await call<{ circle: { id: string }; secrets: { keyName: string; access: { state: string } }[]; vaults: unknown[] }>("authoryx_list_secrets", { circle: "deploy" });
    const byId = await call<typeof byName>("authoryx_list_secrets", { circle: circles[0]!.id });
    assert.deepEqual(byName, byId);
    assert.deepEqual(byName.secrets.map((s) => s.keyName), ["API_TOKEN", "GH_LOGIN", "OTP", "NOTE"]);
    assert.ok(!JSON.stringify(byName).includes(api.circles[0]!.secrets[0]!.value));
  });

  it("an unreachable circle gets the same not-found answer whether it exists or not", async () => {
    await refused(call("authoryx_list_secrets", { circle: "Nope" }), EXIT.notFound, /Not found\. It does not exist, or this agent cannot reach it/);
    await refused(call("authoryx_list_secrets", { circle: randomUUID() }), EXIT.notFound, /Not found\. It does not exist, or this agent cannot reach it/);
  });

  it("a circle name that matches two circles lists both and stops", async () => {
    await refused(call("authoryx_list_secrets", { circle: "Twin" }), EXIT.usage, /More than one circle is named "Twin": Twin \(.+\), twin \(.+\)\. Use the id\./);
  });

  it("request_access returns a pending answer with who is awaited, the time left and the link", async () => {
    const v = await call<RequestView>("authoryx_request_access", { circle: "Deploy", keys: ["API_TOKEN"], reason: "deploy the docs" });
    assert.equal(v.state, "pending");
    assert.deepEqual(v.awaiting, [{ label: "The secret's owner", keys: ["API_TOKEN"] }]);
    assert.ok(v.secondsLeft! > 250 && v.secondsLeft! <= 300);
    assert.match(v.approvalUrl!, /\/r\//);
    assert.equal(v.next, PENDING_NEXT);
    await call("authoryx_close_request", { requestId: v.requestId, outcome: "abandoned" });
  });

  it("refuses an empty reason or more than ten keys before calling the API", async () => {
    const before = api.calls.length;
    await refused(call("authoryx_request_access", { circle: "Deploy", keys: ["API_TOKEN"], reason: "  " }), EXIT.usage, /reason/);
    await refused(call("authoryx_request_access", { circle: "Deploy", keys: Array.from({ length: 11 }, (_, i) => `K${i}`), reason: "x" }), EXIT.usage, /at most 10/);
    assert.equal(api.calls.length, before);
  });

  it("at five pending requests, says so and lists their ids", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push((await call<RequestView>("authoryx_request_access", { circle: "Deploy", keys: ["OTP"], reason: `p${i}` })).requestId);
    await assert.rejects(call("authoryx_request_access", { circle: "Deploy", keys: ["OTP"], reason: "sixth" }), (e: Error & { exit?: number; details?: { pendingRequestIds: string[] } }) => {
      assert.equal(e.exit, EXIT.limit);
      assert.match(e.message, /already has 5 requests waiting/);
      assert.ok(ids.some((id) => e.message.includes(id)));
      return true;
    });
    for (const id of ids) await call("authoryx_close_request", { requestId: id, outcome: "abandoned" });
  });

  it("check_request waits for the answer, reading at most every poll interval", async () => {
    const v = await call<RequestView>("authoryx_request_access", { circle: "Deploy", keys: ["API_TOKEN"], reason: "wait" });
    setTimeout(() => api.approve(v.requestId), 100);
    const reads = () => api.calls.filter((c) => c.path.endsWith(v.requestId)).length;
    const start = reads();
    const done = await call<RequestView>("authoryx_check_request", { requestId: v.requestId, wait: 5 });
    assert.equal(done.state, "approved");
    assert.ok(reads() - start <= 100 / 20 + 3);
    await call("authoryx_close_request", { requestId: v.requestId });
  });

  it("check_request says which keys were denied or expired and that a new request is needed", async () => {
    const v = await call<RequestView>("authoryx_request_access", { circle: "Deploy", keys: ["API_TOKEN", "NOTE"], reason: "mixed" });
    api.deny(v.requestId, ["API_TOKEN"]);
    api.expire(v.requestId);
    const out = await call<RequestView>("authoryx_check_request", { requestId: v.requestId });
    assert.match(out.next, /Denied: API_TOKEN\./);
    assert.match(out.next, /Expired: NOTE\./);
    assert.match(out.next, /new request/);
  });

  it("run with an approved request runs the program with the value and returns redacted output", async () => {
    api.setAutoApprove(true);
    const v = await call<RequestView>("authoryx_request_access", { circle: "Deploy", keys: ["API_TOKEN"], reason: "run" });
    const r = await call<RunResult>("authoryx_run", { requestId: v.requestId, keys: ["API_TOKEN"], command: [node, "-e", "console.log('got', process.env.API_TOKEN)"] });
    assert.equal(r.ran, true);
    assert.equal(r.exitCode, 0);
    assert.equal(r.output.trim(), "got [redacted:API_TOKEN]");
    assert.equal(r.redactions, 1);
    await call("authoryx_close_request", { requestId: v.requestId });
  });

  it("run without a request opens one: runs when approved at once, runs nothing while pending", async () => {
    api.setAutoApprove(true);
    const r = await call<RunResult>("authoryx_run", { circle: "Deploy", reason: "one go", keys: ["NOTE"], command: [node, "-e", "console.log(process.env.NOTE.length)"] });
    assert.equal(r.ran, true);
    await call("authoryx_close_request", { requestId: r.requestId });
    api.setAutoApprove(false);
    const p = await call<RequestView & { ran?: boolean }>("authoryx_run", { circle: "Deploy", reason: "pending", keys: ["NOTE"], command: [node, "-e", "process.exit(9)"] });
    assert.equal(p.ran, undefined);
    assert.equal(p.state, "pending");
    assert.equal(p.next, PENDING_NEXT);
    await call("authoryx_close_request", { requestId: p.requestId, outcome: "abandoned" });
  });

  for (const how of ["pending", "denied", "expired", "past its use time"] as const) {
    it(`run with a ${how} key starts nothing and returns each key's state`, async () => {
      const v = await call<RequestView>("authoryx_request_access", { circle: "Deploy", keys: ["API_TOKEN", "NOTE"], reason: how });
      api.approve(v.requestId, ["NOTE"]);
      if (how === "denied") api.deny(v.requestId, ["API_TOKEN"]);
      if (how === "expired") api.expire(v.requestId);
      if (how === "past its use time") {
        api.approve(v.requestId);
        api.expireUse(v.requestId);
      }
      const fetchesBefore = api.calls.filter((c) => c.path.endsWith("/fetch")).length;
      const out = await call<RequestView & { ran?: boolean }>("authoryx_run", { requestId: v.requestId, keys: ["API_TOKEN", "NOTE"], command: [node, "-e", "process.exit(9)"] });
      assert.equal(out.ran, undefined);
      assert.ok(out.items.some((i) => i.key === "API_TOKEN" && i.state !== "approved"));
      assert.equal(api.calls.filter((c) => c.path.endsWith("/fetch")).length, fetchesBefore);
    });
  }

  it("after close, run runs nothing", async () => {
    api.setAutoApprove(true);
    const v = await call<RequestView>("authoryx_request_access", { circle: "Deploy", keys: ["API_TOKEN"], reason: "close" });
    const closed = await call<RequestView>("authoryx_close_request", { requestId: v.requestId, outcome: "done" });
    assert.equal(closed.state, "closed");
    const out = await call<RequestView & { ran?: boolean }>("authoryx_run", { requestId: v.requestId, keys: ["API_TOKEN"], command: [node, "-e", "process.exit(9)"] });
    assert.equal(out.ran, undefined);
    assert.equal(out.state, "closed");
  });

  it("run refuses a key the request does not name", async () => {
    api.setAutoApprove(true);
    const v = await call<RequestView>("authoryx_request_access", { circle: "Deploy", keys: ["API_TOKEN"], reason: "scope" });
    await refused(call("authoryx_run", { requestId: v.requestId, keys: ["NOTE"], command: [node, "-v"] }), EXIT.usage, /Not in request .*NOTE/);
    await call("authoryx_close_request", { requestId: v.requestId });
  });

  it("fetch hands the value to the caller; it is a command-line tool only", async () => {
    api.setAutoApprove(true);
    const out = await call<{ value: { type: string; value?: string } }>("authoryx_fetch", { key: "API_TOKEN", circle: "Deploy", reason: "script" });
    assert.equal(out.value.value, api.circles[0]!.secrets[0]!.value);
    assert.deepEqual(tool("authoryx_fetch").surfaces, ["cli"]);
  });
});
