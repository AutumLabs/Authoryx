import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CAPABILITIES, Registry, defaultRegistry, granted, type ToolDef } from "../src/index.ts";

const standInT2: ToolDef = {
  name: "authoryx_test_signin",
  cli: "test-signin",
  capability: "web.signin",
  tier: "t2",
  surfaces: ["mcp", "cli"],
  summary: "A stand-in T2 tool for tests.",
  returns: "ok",
  never: "the secret",
  input: { type: "object" },
  run: async () => "ok",
};

describe("tool registry (ADR-0020)", () => {
  const reg = defaultRegistry();

  it("every tool has a tier and a capability listed in protocol/capabilities.md", () => {
    const doc = readFileSync(new URL("../../../protocol/capabilities.md", import.meta.url), "utf8");
    for (const t of reg.all()) {
      assert.ok(["none", "t1", "t2"].includes(t.tier), t.name);
      assert.ok(CAPABILITIES.some((c) => c.id === t.capability), t.name);
      assert.ok(doc.includes(`\`${t.capability}\``), `${t.capability} missing from capabilities.md`);
    }
  });

  it("with no capability list offers Ask and Run with secrets on MCP, and fetch too on the command line", () => {
    const mcp = reg.toolsFor("mcp", {}).map((t) => t.name);
    assert.deepEqual(mcp, [
      "authoryx_whoami",
      "authoryx_list_circles",
      "authoryx_list_secrets",
      "authoryx_request_access",
      "authoryx_check_request",
      "authoryx_run",
      "authoryx_close_request",
    ]);
    const cli = reg.toolsFor("cli", {}).map((t) => t.cli);
    assert.deepEqual(cli, ["whoami", "circles", "secrets", "request", "status", "run", "close", "fetch"]);
  });

  it("fetch is never on the MCP surface, and the registry refuses to put it there", () => {
    assert.ok(!reg.toolsFor("mcp", { capabilities: ["fetch"] }).some((t) => t.capability === "fetch"));
    assert.throws(() => new Registry().add({ ...standInT2, name: "x", cli: "x", capability: "fetch", tier: "t1", surfaces: ["mcp"] }), /never an MCP tool/);
  });

  it("a T2 tool is neither listed nor found until its capability is granted", () => {
    const r = defaultRegistry().add(standInT2);
    assert.equal(r.find("mcp", {}, "authoryx_test_signin"), undefined);
    assert.ok(!r.toolsFor("mcp", {}).some((t) => t.tier === "t2"));
    assert.ok(r.find("mcp", { capabilities: ["web.signin"] }, "authoryx_test_signin"));
  });

  it("an unknown capability id is ignored", () => {
    const g = granted({ capabilities: ["teleport", "web.signin", "connector.github", "connector.<service>"] });
    assert.deepEqual([...g].sort(), ["ask", "connector.github", "fetch", "run", "web.signin"]);
  });

  it("refuses a tool without a known capability or with the wrong tier", () => {
    assert.throws(() => new Registry().add({ ...standInT2, capability: "teleport" }), /not in protocol\/capabilities\.md/);
    assert.throws(() => new Registry().add({ ...standInT2, tier: "t1" }), /does not match/);
  });

  it("this release registers no T2 tool", () => {
    assert.ok(!reg.all().some((t) => t.tier === "t2"));
  });
});
