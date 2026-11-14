import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { startFakeApi, newAgentKey, type FakeApi } from "@authoryx/fake-agent-api";
import { EXIT, memoryKeyStore } from "@authoryx/core";
import { makeIo } from "./helpers.ts";

let api: FakeApi;

describe("authoryx login and logout (FR-007)", () => {
  before(async () => {
    api = await startFakeApi({ agentName: "QS bot" });
  });
  after(() => api.close());

  it("reads the id and a hidden key at the prompt, checks whoami, stores one keychain item", async () => {
    const t = makeIo({ tty: true, answers: [api.agentId, api.agentKey] });
    const r = await t.exec("login", "--api", api.url);
    assert.equal(r.code, EXIT.ok, r.stderr);
    assert.match(r.stdout, /Signed in as QS bot/);
    assert.deepEqual(t.io.prompts.map((p) => p.hidden), [false, true]);
    assert.deepEqual([...t.store.items.keys()], [api.agentId]);
    const settings = readFileSync(t.io.settingsFile, "utf8");
    assert.ok(!settings.includes(api.agentKey));
    assert.ok(!r.stdout.includes(api.agentKey) && !r.stderr.includes(api.agentKey));
    const who = await t.exec("whoami");
    assert.match(who.stdout, /Key from the keychain/);
  });

  it("reads the key from standard input", async () => {
    const t = makeIo({ stdin: `${api.agentKey}\n` });
    const r = await t.exec("login", "--api", api.url, "--agent", api.agentId);
    assert.equal(r.code, EXIT.ok, r.stderr);
    assert.equal(t.store.items.size, 1);
  });

  it("refuses the key as an argument and says why", async () => {
    const t = makeIo({});
    for (const argv of [["login", "--key", api.agentKey], ["login", `--key=${api.agentKey}`], ["login", api.agentKey]]) {
      const r = await t.exec(...argv);
      assert.equal(r.code, EXIT.usage);
      assert.match(r.stderr, /Never pass the agent key as an argument/);
      assert.ok(!r.stderr.includes(api.agentKey));
    }
    assert.equal(t.store.items.size, 0);
  });

  it("a refused sign-in stores nothing and prints no key", async () => {
    const wrong = newAgentKey();
    const t = makeIo({ stdin: `${wrong}\n` });
    const r = await t.exec("login", "--api", api.url, "--agent", api.agentId);
    assert.equal(r.code, EXIT.unauthorized);
    assert.match(r.stderr, /did not accept this agent's id and key/);
    assert.ok(!r.stderr.includes(wrong));
    assert.equal(t.store.items.size, 0);
    assert.ok(!existsSync(t.io.settingsFile));
  });

  it("logout removes the keychain item; a later verb says no agent is signed in", async () => {
    const t = makeIo({ stdin: `${api.agentKey}\n` });
    await t.exec("login", "--api", api.url, "--agent", api.agentId);
    const out = await t.exec("logout");
    assert.match(out.stdout, /keychain item is removed/);
    assert.equal(t.store.items.size, 0);
    const later = await t.exec("circles");
    assert.equal(later.code, EXIT.unauthorized);
    assert.match(later.stderr, /No agent is signed in/);
  });

  it("with the environment set, uses it, stores nothing and says so", async () => {
    const t = makeIo({ env: { AUTHORYX_AGENT_ID: api.agentId, AUTHORYX_AGENT_KEY: api.agentKey, AUTHORYX_API_URL: api.url } });
    const r = await t.exec("whoami");
    assert.equal(r.code, EXIT.ok, r.stderr);
    assert.match(r.stdout, /Key from the environment/);
    assert.equal(t.store.items.size, 0);
  });

  it("with no keychain, login refuses and names the environment variables", async () => {
    const t = makeIo({ stdin: `${api.agentKey}\n` });
    t.io.store = memoryKeyStore(false) as typeof t.io.store;
    const r = await t.exec("login", "--api", api.url, "--agent", api.agentId);
    assert.equal(r.code, EXIT.unauthorized);
    assert.match(r.stderr, /AUTHORYX_AGENT_ID, AUTHORYX_AGENT_KEY and AUTHORYX_API_URL/);
  });

  it("doctor reports each check without the key", async () => {
    const t = makeIo({ env: { AUTHORYX_AGENT_ID: api.agentId, AUTHORYX_AGENT_KEY: api.agentKey, AUTHORYX_API_URL: api.url } });
    const r = await t.exec("doctor");
    assert.equal(r.code, EXIT.ok, r.stdout);
    assert.match(r.stdout, /^ok +api: signed in as QS bot/m);
    assert.ok(!r.stdout.includes(api.agentKey));
  });
});
