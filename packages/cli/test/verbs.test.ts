import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { startFakeApi, type FakeApi } from "@authoryx/fake-agent-api";
import { EXIT } from "@authoryx/core";
import { makeIo } from "./helpers.ts";

let api: FakeApi;
let env: NodeJS.ProcessEnv;
const node = process.execPath;
const ex = (...argv: string[]) => makeIo({ env }).exec(...argv);
const exTTY = (...argv: string[]) => makeIo({ env, stdoutTTY: true }).exec(...argv);

describe("authoryx verbs (FR-008, FR-009)", () => {
  before(async () => {
    api = await startFakeApi();
    env = { AUTHORYX_AGENT_ID: api.agentId, AUTHORYX_AGENT_KEY: api.agentKey, AUTHORYX_API_URL: api.url };
  });
  after(() => api.close());
  beforeEach(() => api.setAutoApprove(false));

  it("each read verb prints a table or sentence, and the same data with --json", async () => {
    for (const argv of [["whoami"], ["circles"], ["secrets", "Deploy"]]) {
      const text = await ex(...argv);
      const json = await ex(...argv, "--json");
      assert.equal(text.code, EXIT.ok, text.stderr);
      assert.doesNotThrow(() => JSON.parse(json.stdout), argv.join(" "));
      assert.ok(!text.stdout.trimStart().startsWith("{"));
    }
    assert.match((await ex("circles")).stdout, /^ID\s+NAME\s+DESCRIPTION/);
    assert.match((await ex("secrets", "Deploy")).stdout, /API_TOKEN\s+Deploy token\s+api_key\s+CI\s+ask/);
  });

  it("request prints the approval link; status and close follow it", async () => {
    const r = await ex("request", "Deploy", "API_TOKEN", "--reason", "deploy", "--json");
    const v = JSON.parse(r.stdout);
    assert.equal(v.state, "pending");
    const text = await ex("status", v.requestId);
    assert.equal(text.code, EXIT.notApproved);
    assert.match(text.stdout, /Approve or deny: https:\/\/.+\/r\//);
    const c = await ex("close", v.requestId, "--outcome", "abandoned");
    assert.equal(c.code, EXIT.ok);
    assert.match(c.stdout, /is closed/);
  });

  for (const [answer, exit] of [["approve", EXIT.ok], ["deny", EXIT.denied], ["expire", EXIT.expired]] as const) {
    it(`request --wait prints the link at once and exits ${exit} when the owner's answer is ${answer}`, async () => {
      const t = makeIo({ env });
      const p = t.exec("request", "Deploy", "NOTE", "--reason", "wait", "--wait", "5");
      await new Promise((r) => setTimeout(r, 60));
      const id = api.lastRequestId()!;
      if (answer === "approve") api.approve(id);
      if (answer === "deny") api.deny(id);
      if (answer === "expire") api.expire(id);
      const r = await p;
      assert.equal(r.code, exit, r.stdout + r.stderr);
      assert.match(r.stdout.split("\n")[1] ?? "", /^Approve or deny: /);
      await ex("close", id);
    });
  }

  it("request --wait that runs out exits 73", async () => {
    const r = await ex("request", "Deploy", "OTP", "--reason", "short", "--wait", "1");
    assert.equal(r.code, EXIT.notApproved);
    assert.match(r.stdout, /Still waiting after 1 seconds/);
    await ex("close", api.lastRequestId()!);
  });

  it("run passes the program's exit status and prints redacted output", async () => {
    api.setAutoApprove(true);
    const r = await ex("run", "--circle", "Deploy", "--reason", "go", "--key", "API_TOKEN", "--", node, "-e", "console.log(process.env.API_TOKEN);process.exit(4)");
    assert.equal(r.code, 4);
    assert.equal(r.stdout.trim(), "[redacted:API_TOKEN]");
    assert.match(r.stderr, /1 value removed from the output/);
    assert.ok(!r.stdout.includes(api.circles[0]!.secrets[0]!.value));
  });

  it("run with a pending request runs nothing and exits 73", async () => {
    const r = await ex("run", "--circle", "Deploy", "--reason", "go", "--key", "NOTE", "--", node, "-e", "process.exit(9)");
    assert.equal(r.code, EXIT.notApproved);
    assert.match(r.stdout, /Approve or deny/);
    await ex("close", api.lastRequestId()!);
  });

  it("a circle name that matches two circles lists both and stops", async () => {
    api.circles.push({ id: crypto.randomUUID(), name: "Ops", secrets: [] }, { id: crypto.randomUUID(), name: "ops", secrets: [] });
    const r = await ex("secrets", "Ops");
    assert.equal(r.code, EXIT.usage);
    assert.match(r.stderr, /More than one circle is named "Ops"/);
  });

  it("fetch writes the value and a newline to a pipe, and a login field with --field", async () => {
    api.setAutoApprove(true);
    const s = api.circles[0]!.secrets;
    const one = await ex("fetch", "API_TOKEN", "--circle", "Deploy", "--reason", "script");
    assert.equal(one.code, EXIT.ok, one.stderr);
    assert.equal(one.stdout, `${s[0]!.value}\n`);
    const pw = await ex("fetch", "GH_LOGIN", "--circle", "Deploy", "--reason", "script");
    assert.equal(pw.stdout, `${s[1]!.value}\n`);
    const user = await ex("fetch", "GH_LOGIN", "--circle", "Deploy", "--reason", "script", "--field", "username");
    assert.equal(user.stdout, "release-bot\n");
  });

  it("fetch to a terminal prints no value without --show", async () => {
    api.setAutoApprove(true);
    const r = await exTTY("fetch", "API_TOKEN", "--circle", "Deploy", "--reason", "script");
    assert.equal(r.code, EXIT.usage);
    assert.equal(r.stdout, "");
    assert.match(r.stderr, /prints no value to a terminal.*Pipe it.*authoryx run/);
    const shown = await exTTY("fetch", "API_TOKEN", "--circle", "Deploy", "--reason", "script", "--show");
    assert.equal(shown.stdout.trim(), api.circles[0]!.secrets[0]!.value);
  });

  it("each API refusal prints its sentence and exits with its status", async () => {
    api.setOff(true);
    const off = await ex("circles");
    api.setOff(false);
    assert.equal(off.code, EXIT.apiOff);
    assert.match(off.stderr, /switched off/);
    const nf = await ex("status", "00000000-0000-0000-0000-000000000000");
    assert.equal(nf.code, EXIT.notFound);
    api.setApiVersion(9);
    const v = await ex("circles");
    api.setApiVersion(1);
    assert.equal(v.code, EXIT.version);
    const bad = await makeIo({ env: { ...env, AUTHORYX_AGENT_KEY: "axa_" + "Z".repeat(43) } }).exec("circles");
    assert.equal(bad.code, EXIT.unauthorized);
  });

  it("help is generated from the registry and lists fetch, which MCP never offers", async () => {
    const h = await ex("--help");
    assert.match(h.stdout, /fetch <KEY>/);
    assert.match(h.stdout, /Run a program with approved secrets/);
  });
});
