import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";

import {
  AccessDeniedError,
  Client,
  InvalidIntentError,
  PauseStore,
  PendingTimeoutError,
  SecretStr,
  TransportError,
} from "../src/index.js";

const API_KEY = "axos_live_" + "a".repeat(20);

function tmpStore(): PauseStore {
  const dir = mkdtempSync(join(tmpdir(), "axos-"));
  return new PauseStore(join(dir, "p.db"));
}

function mockFetch(handler: (req: Request) => Promise<Response> | Response): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(typeof input === "string" || input instanceof URL ? input.toString() : input.url, init);
    return handler(req);
  }) as typeof fetch;
}

function jsonResp(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("fetch happy path returns SecretStr that hides itself", async () => {
  const client = new Client({
    apiKey: API_KEY,
    baseUrl: "http://x",
    pauseStore: tmpStore(),
    fetch: mockFetch(() =>
      jsonResp(200, {
        status: "approved",
        token: "pending_x",
        secret: "S3CR3T",
        decision_by: "auto",
        decided_at: "2025-01-01T00:00:00Z",
        audit_id: "audit_x",
      }),
    ),
  });
  const s = await client.fetch({ key: "TEST_KEY", intent: "hi" });
  assert.ok(s instanceof SecretStr);
  assert.equal(s.reveal(), "S3CR3T");
  assert.equal(String(s), "***");
  assert.equal(JSON.stringify(s), '"***"');
});

test("withSecret never returns the secret", async () => {
  const client = new Client({
    apiKey: API_KEY,
    baseUrl: "http://x",
    pauseStore: tmpStore(),
    fetch: mockFetch(() =>
      jsonResp(200, {
        status: "approved", token: "pending_x", secret: "S3CR3T",
        decision_by: "auto", decided_at: "x", audit_id: "x",
      }),
    ),
  });
  let seen = "";
  const n = await client.withSecret({
    key: "TEST_KEY",
    intent: "use",
    exec: (s) => {
      seen = s;
      return s.length;
    },
  });
  assert.equal(n, 6);
  assert.equal(seen, "S3CR3T");
});

test("denied surfaces AccessDeniedError", async () => {
  const client = new Client({
    apiKey: API_KEY, baseUrl: "http://x", pauseStore: tmpStore(),
    fetch: mockFetch(() =>
      jsonResp(200, {
        status: "denied", token: "pending_x", reason: "no",
        decided_at: "x", audit_id: "y",
      }),
    ),
  });
  await assert.rejects(
    () => client.fetch({ key: "TEST_KEY", intent: "x" }),
    AccessDeniedError,
  );
});

test("replayed nonce surfaces TransportError with code", async () => {
  const client = new Client({
    apiKey: API_KEY, baseUrl: "http://x", pauseStore: tmpStore(),
    fetch: mockFetch(() =>
      jsonResp(400, {
        error: { code: "replayed_nonce", message: "nope", retryable: false },
      }),
    ),
  });
  await assert.rejects(
    () => client.fetch({ key: "TEST_KEY", intent: "x" }),
    (e: unknown) => e instanceof TransportError && (e as TransportError).code === "replayed_nonce",
  );
});

test("pending then approved resolves", async () => {
  let polls = 0;
  const client = new Client({
    apiKey: API_KEY, baseUrl: "http://x", pauseStore: tmpStore(),
    fetch: mockFetch((req) => {
      if (req.method === "POST") {
        return jsonResp(200, {
          status: "pending", token: "pending_abc",
          poll_url: "/v1/os/pending/pending_abc",
          poll_interval_seconds: 0,
          expires_at: "2099-01-01T00:00:00Z",
        });
      }
      polls++;
      if (polls < 2) {
        return jsonResp(200, {
          status: "pending", token: "pending_abc",
          poll_url: "/v1/os/pending/pending_abc",
          poll_interval_seconds: 0,
          expires_at: "2099-01-01T00:00:00Z",
        });
      }
      return jsonResp(200, {
        status: "approved", token: "pending_abc", secret: "OK",
        decision_by: "owner", decided_at: "x", audit_id: "a",
      });
    }),
  });
  const s = await client.fetch({ key: "TEST_KEY", intent: "x" });
  assert.equal(s.reveal(), "OK");
  assert.equal(client.pause.all().length, 0);
});

test("pending timeout raises PendingTimeoutError", async () => {
  const client = new Client({
    apiKey: API_KEY, baseUrl: "http://x", pauseStore: tmpStore(),
    timeoutSeconds: 0,
    fetch: mockFetch(() =>
      jsonResp(200, {
        status: "pending", token: "pending_t",
        poll_url: "/v1/os/pending/pending_t",
        poll_interval_seconds: 0,
        expires_at: "2099-01-01T00:00:00Z",
      }),
    ),
  });
  await assert.rejects(
    () => client.fetch({ key: "TEST_KEY", intent: "x" }),
    PendingTimeoutError,
  );
});

test("invalid api key format rejected client-side", async () => {
  const client = new Client({ apiKey: "bad", baseUrl: "http://x", pauseStore: tmpStore() });
  await assert.rejects(
    () => client.fetch({ key: "TEST_KEY", intent: "x" }),
    InvalidIntentError,
  );
});
