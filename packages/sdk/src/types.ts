/** The agent API's shapes, as protocol/agent-api.md and protocol/schemas define them. */

export type SecretType = "login" | "api_key" | "totp" | "note";
export type RequestState = "pending" | "approved" | "denied" | "expired" | "closed";
export type ItemState = "pending" | "approved" | "denied" | "expired";
export type Hint = "once" | "1h" | "always";
export type Outcome = "done" | "abandoned" | "failed";

export interface WhoAmI {
  agent: { id: string; name: string; hostKind: string };
  apiVersion: number;
  /** Capability ids granted beyond ask, run and fetch. Not sent by API version 1 today. */
  capabilities?: string[];
}

export interface Circle {
  id: string;
  name: string;
  description: string | null;
}

export interface SharedVault {
  name: string;
  description: string | null;
}

export type Access =
  | { state: "ask"; pendingRequestId?: string }
  | { state: "allowed"; until: string; requestId: string }
  | { state: "blocked" };

export interface Share {
  keyName: string;
  name: string;
  type: SecretType;
  description: string | null;
  vault: SharedVault | null;
  access: Access;
}

export interface RequestItem {
  keyName: string;
  state: ItemState;
  usableUntil: string | null;
}

export interface Request {
  id: string;
  circleId: string;
  state: RequestState;
  reason: string;
  hint: Hint | null;
  createdAt: string;
  expiresAt: string;
  usableUntil: string | null;
  closedAt: string | null;
  outcome: string | null;
  items: RequestItem[];
  awaiting: { label: string; keyNames: string[] }[];
  approvalUrl: string;
}

export type Value =
  | { keyName: string; type: "login"; username: string | null; password: string; url: string | null; version: number }
  | { keyName: string; type: "api_key" | "note"; value: string; version: number }
  | { keyName: string; type: "totp"; code: string; expiresAt: string; version: number };
