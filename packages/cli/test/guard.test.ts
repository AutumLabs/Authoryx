import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error: a plain .mjs hook file with no types
import { check } from "../hooks/guard.mjs";
import { makeIo } from "./helpers.ts";

const GUARD = fileURLToPath(new URL("../hooks/guard.mjs", import.meta.url));

const DENY = [
  "authoryx fetch API_TOKEN --request r1",
  "npx -y authoryx fetch API_TOKEN --circle Deploy --reason x",
  "cd app && authoryx --json fetch API_TOKEN",
  "echo $(authoryx fetch NOTE --request r)",
  "env",
  "printenv",
  "set",
  "export -p",
  "declare -x",
  "ls; env | sort",
  "printenv AUTHORYX_AGENT_KEY",
  "echo $AUTHORYX_AGENT_KEY",
  "node -e 'console.log(process.env.AUTHORYX_AGENT_KEY)'",
  "cat /proc/self/environ",
  "security find-generic-password -s authoryx -w",
  "secret-tool lookup service authoryx",
];
const ALLOW = [
  "authoryx run --request r1 --key API_TOKEN -- npm run deploy",
  "authoryx secrets Deploy",
  "npm test",
  "env NODE_ENV=test npm test",
  "git log --oneline",
  "echo fetch the docs",
  "grep -r environment src/",
];

describe("the guard hook (FR-012)", () => {
  for (const c of DENY) it(`denies: ${c}`, () => assert.match(check(c) ?? "", /Use authoryx_run: the value goes to the program, not to this conversation\.$/));
  for (const c of ALLOW) it(`stays silent: ${c}`, () => assert.equal(check(c), null));

  it("speaks the PreToolUse protocol on stdin and stdout", () => {
    const deny = spawnSync(process.execPath, [GUARD], { input: JSON.stringify({ tool_name: "Bash", tool_input: { command: "authoryx fetch X --request r" } }), encoding: "utf8" });
    const out = JSON.parse(deny.stdout);
    assert.equal(out.hookSpecificOutput.hookEventName, "PreToolUse");
    assert.equal(out.hookSpecificOutput.permissionDecision, "deny");
    const allow = spawnSync(process.execPath, [GUARD], { input: JSON.stringify({ tool_name: "Bash", tool_input: { command: "npm test" } }), encoding: "utf8" });
    assert.equal(allow.stdout, "");
    assert.equal(allow.status, 0);
  });

  it("hooks install adds the guard once, keeps other hooks and says it is not a sandbox", async () => {
    const t = makeIo({});
    const file = join(t.dir, ".claude", "settings.json");
    mkdirSync(join(t.dir, ".claude"), { recursive: true });
    const other = { matcher: "Edit", hooks: [{ type: "command", command: "echo other" }] };
    writeFileSync(file, JSON.stringify({ model: "x", hooks: { PreToolUse: [other], PostToolUse: [other] } }));
    const first = await t.exec("hooks", "install");
    assert.equal(first.code, 0, first.stderr);
    assert.match(first.stdout, /Added the Authoryx guard/);
    assert.match(first.stdout, /It is not a sandbox/);
    const second = await t.exec("hooks", "install");
    assert.match(second.stdout, /Kept the Authoryx guard/);
    const s = JSON.parse(readFileSync(file, "utf8"));
    assert.equal(s.model, "x");
    assert.deepEqual(s.hooks.PostToolUse, [other]);
    assert.equal(s.hooks.PreToolUse.length, 2);
    assert.deepEqual(s.hooks.PreToolUse[0], other);
    assert.equal(s.hooks.PreToolUse[1].matcher, "Bash");
    assert.match(s.hooks.PreToolUse[1].hooks[0].command, /guard\.mjs/);
  });

  it("hooks print shows the snippet", async () => {
    const r = await makeIo({}).exec("hooks", "print");
    assert.equal(JSON.parse(r.stdout).hooks.PreToolUse[0].matcher, "Bash");
  });
});
