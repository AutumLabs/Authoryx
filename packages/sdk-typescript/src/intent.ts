import { randomBytes, randomUUID } from "node:crypto";
import { InvalidIntentError } from "./errors.js";

export const API_KEY_RE = /^axos_live_[A-Za-z0-9]{20,}$/;
export const KEY_NAME_RE = /^[A-Z][A-Z0-9_]{0,127}$/;

export type PolicyHint = "approve_once" | "always_approve" | "require_approval";

export interface IntentRequest {
  api_key: string;
  key_name: string;
  intent: string;
  agent_id: string;
  session_id: string;
  nonce: string;
  timestamp: string;
  policy_hint?: PolicyHint;
}

export interface BuildArgs {
  apiKey: string;
  keyName: string;
  intent: string;
  agentId?: string;
  sessionId?: string;
  policy?: PolicyHint;
}

export function build(args: BuildArgs): IntentRequest {
  if (!API_KEY_RE.test(args.apiKey)) {
    throw new InvalidIntentError("api_key must match 'axos_live_[A-Za-z0-9]{20,}'");
  }
  if (!KEY_NAME_RE.test(args.keyName)) {
    throw new InvalidIntentError("key_name must be SCREAMING_SNAKE_CASE");
  }
  if (!args.intent || args.intent.length > 4096) {
    throw new InvalidIntentError("intent must be 1–4096 chars");
  }
  if (
    args.policy !== undefined &&
    !["approve_once", "always_approve", "require_approval"].includes(args.policy)
  ) {
    throw new InvalidIntentError(`unknown policy hint: ${String(args.policy)}`);
  }
  const req: IntentRequest = {
    api_key: args.apiKey,
    key_name: args.keyName,
    intent: args.intent,
    agent_id: args.agentId ?? `agent-${randomUUID().replace(/-/g, "").slice(0, 8)}`,
    session_id: args.sessionId ?? `session-${randomUUID().replace(/-/g, "").slice(0, 8)}`,
    nonce: randomBytes(12).toString("hex"),
    timestamp: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
  };
  if (args.policy) req.policy_hint = args.policy;
  return req;
}
