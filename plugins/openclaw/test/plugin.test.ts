import { test } from "node:test";
import assert from "node:assert/strict";

import plugin, { fetchSecret } from "../src/index.js";
import { attach, configure, _reset } from "../src/runtime.js";
import { AccessDeniedError, Client, PauseStore } from "authoryxos";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";

const API_KEY = "axos_live_" + "a".repeat(20);

function tmpStore(): PauseStore {
  const dir = mkdtempSync(join(tmpdir(), "axos-plug-"));
  return new PauseStore(join(dir, "p.db"));
}

function clientWith(handler: (req: Request) => Response | Promise<Response>): Client {
  return new Client({
    apiKey: API_KEY,
    baseUrl: "http://x",
    pauseStore: tmpStore(),
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" || input instanceof URL ? input.toString() : input.url;
      return handler(new Request(url, init));
    }) as typeof fetch,
  });
}

function jsonResp(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("plugin default export has manifest-shaped fields", () => {
  assert.equal(plugin.name, "@authoryxos/openclaw-plugin");
  assert.equal(typeof plugin.hooks.onAgentStart, "function");
  assert.equal(typeof plugin.hooks.onToolCall, "function");
  assert.equal(typeof plugin.tools.authoryxos_fetch_secret, "function");
});

test("fetchSecret throws when not configured", async () => {
  _reset();
  await assert.rejects(() => fetchSecret({ key: "TEST_KEY", intent: "x" }), /not configured/);
});

test("fetchSecret rejects empty input", async () => {
  _reset();
  configure({ apiKey: API_KEY, baseUrl: "http://unreachable" });
  const r = await fetchSecret({ key: "", intent: "" });
  assert.equal(r.ok, false);
  assert.equal(r.error?.code, "invalid_intent");
});

test("fetchSecret returns revealed value on approval", async () => {
  _reset();
  attach(
    clientWith(() =>
      jsonResp(200, {
        status: "approved", token: "pending_x", secret: "PLAINTEXT",
        decision_by: "auto", decided_at: "x", audit_id: "a",
      }),
    ),
  );
  const r = await fetchSecret({ key: "TEST_KEY", intent: "approve in test" });
  assert.equal(r.ok, true);
  assert.equal(r.value, "PLAINTEXT");
});

test("fetchSecret maps AccessDeniedError to structured error", async () => {
  _reset();
  attach(
    clientWith(() =>
      jsonResp(200, {
        status: "denied", token: "pending_x", reason: "spam",
        decided_at: "x", audit_id: "y",
      }),
    ),
  );
  const r = await fetchSecret({ key: "TEST_KEY", intent: "x" });
  assert.equal(r.ok, false);
  assert.equal(r.error?.code, "denied");
  assert.equal(r.error?.message, "spam");
});

test("fetchSecret maps transport errors to structured error", async () => {
  _reset();
  attach(
    clientWith(() =>
      jsonResp(400, {
        error: { code: "replayed_nonce", message: "nope", retryable: false },
      }),
    ),
  );
  const r = await fetchSecret({ key: "TEST_KEY", intent: "x" });
  assert.equal(r.ok, false);
  assert.equal(r.error?.code, "TransportError");
});

test("AccessDeniedError carries reason and token", () => {
  const e = new AccessDeniedError("nope", { reason: "spam", token: "t" });
  assert.equal(e.reason, "spam");
  assert.equal(e.token, "t");
});
