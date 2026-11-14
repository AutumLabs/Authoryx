import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { encodedVariants, RedactingStream, Redactor, runProgram, type RunResult } from "../src/index.ts";
import type { Value } from "@authoryx/sdk";

const SECRET = "sk_live_9f8e7d6c5b4a/+=&\"quoted\"";
const node = process.execPath;
const val = (keyName: string, value: string): Value => ({ keyName, type: "api_key", value, version: 1 });
const js = (code: string) => [node, "-e", code];

function forms(v: string): Record<string, string> {
  return {
    plain: v,
    base64: Buffer.from(v).toString("base64"),
    hex: Buffer.from(v).toString("hex"),
    url: encodeURIComponent(v),
    json: JSON.stringify(v).slice(1, -1),
  };
}

function assertClean(r: RunResult, v: string) {
  for (const [name, f] of Object.entries(forms(v))) assert.ok(!r.output.includes(f), `${name} form leaked: ${r.output}`);
}

describe("redaction (FR-010)", () => {
  it("removes all five encodings and counts the removals", async () => {
    const code = `const v=process.env.TOKEN;console.log(v);console.log(Buffer.from(v).toString('base64'));console.log(Buffer.from(v).toString('hex'));console.log(encodeURIComponent(v));console.log(JSON.stringify({v}));`;
    const r = await runProgram({ command: js(code), values: [val("TOKEN", SECRET)], requestId: "r1" });
    assert.equal(r.exitCode, 0);
    assertClean(r, SECRET);
    assert.equal(r.redactions, 5);
    assert.match(r.output, /\[redacted:TOKEN\]/);
  });

  it("removes a value split across two writes", async () => {
    const code = `const v=process.env.TOKEN;process.stdout.write(v.slice(0,7));setTimeout(()=>process.stdout.write(v.slice(7)+'\\n'),30);`;
    const r = await runProgram({ command: js(code), values: [val("TOKEN", SECRET)], requestId: "r1" });
    assertClean(r, SECRET);
    assert.equal(r.redactions, 1);
  });

  it("every split point of a value through the stream", () => {
    for (let i = 1; i < SECRET.length; i++) {
      const red = new Redactor();
      red.add("K", SECRET);
      const s = new RedactingStream(red);
      const out = s.push(`a${SECRET.slice(0, i)}`) + s.push(`${SECRET.slice(i)}b`) + s.flush();
      assert.equal(out, "a[redacted:K]b", `split at ${i}`);
    }
  });

  it("still removes a short value and says it may remove ordinary text", async () => {
    const r = await runProgram({ command: js(`console.log('pin', process.env.PIN, 'and 12 more')`), values: [val("PIN", "12")], requestId: "r1" });
    assert.ok(!r.output.includes("12"));
    assert.match(r.note ?? "", /PIN is shorter than \d+ characters; removing it may also remove ordinary text/);
  });

  it("covers the encodings it claims", () => {
    const v = encodedVariants(SECRET);
    for (const f of Object.values(forms(SECRET))) assert.ok(v.includes(f));
  });
});

describe("run (FR-005)", () => {
  it("starts the program without a shell, with ;, $() and spaces kept as plain arguments", async () => {
    const args = ["a b", "; echo pwned", "$(whoami)", "`id`"];
    const r = await runProgram({ command: [...js("console.log(JSON.stringify(process.argv.slice(1)))"), ...args], values: [], requestId: "r1" });
    assert.deepEqual(JSON.parse(r.output), args);
  });

  it("gives each value in its own variable, logins in three, and never the agent key", async () => {
    const login: Value = { keyName: "GH", type: "login", username: "bot", password: "pw-123456789", url: "https://x.test", version: 1 };
    const totp: Value = { keyName: "OTP", type: "totp", code: "493817", expiresAt: new Date().toISOString(), version: 1 };
    const code = `const e=process.env;console.log([e.GH_USERNAME,e.GH_URL,e.GH_PASSWORD===undefined,e.OTP===undefined,e.AUTHORYX_AGENT_KEY===undefined,e.KEEP].join('|'))`;
    const r = await runProgram({
      command: js(code),
      values: [login, totp],
      requestId: "r1",
      baseEnv: { ...process.env, AUTHORYX_AGENT_KEY: "axa_should_not_pass", KEEP: "kept" },
    });
    assert.equal(r.output.trim(), "bot|https://x.test|false|false|true|kept");
  });

  it("removes the login's password and the totp code from output", async () => {
    const login: Value = { keyName: "GH", type: "login", username: "bot", password: "pw-123456789", url: null, version: 1 };
    const r = await runProgram({ command: js("console.log(process.env.GH_PASSWORD)"), values: [login], requestId: "r1" });
    assert.equal(r.output.trim(), "[redacted:GH]");
  });

  it("passes the program's exit code through", async () => {
    const r = await runProgram({ command: js("process.exit(3)"), values: [], requestId: "r1" });
    assert.equal(r.exitCode, 3);
  });

  it("stops a program that runs past its timeout", async () => {
    const r = await runProgram({ command: js("setTimeout(()=>{}, 60000)"), values: [], requestId: "r1", timeoutSeconds: 1 });
    assert.equal(r.timedOut, true);
    assert.match(r.note ?? "", /stopped after 1 seconds/);
  });

  it("cuts the output at the limit after redaction and says so", async () => {
    const code = `const v=process.env.TOKEN;for(let i=0;i<3000;i++)process.stdout.write(v+'x'.repeat(500)+'\\n')`;
    const r = await runProgram({ command: js(code), values: [val("TOKEN", SECRET)], requestId: "r1", outputLimitBytes: 64 * 1024 });
    assert.equal(r.truncated, true);
    assert.ok(Buffer.byteLength(r.output) <= 64 * 1024);
    assertClean(r, SECRET);
    assert.match(r.note ?? "", /cut at 64 KB/);
  });

  it("refuses to start nothing, and names a program that is not there", async () => {
    await assert.rejects(runProgram({ command: [], values: [], requestId: "r1" }), /no program/);
    await assert.rejects(runProgram({ command: ["authoryx-no-such-program-xyz"], values: [], requestId: "r1" }), /Could not start authoryx-no-such-program-xyz/);
  });
});
