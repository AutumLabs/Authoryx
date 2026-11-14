/** What an agent sees of a request: states, who is awaited, the link, and one sentence on what to do next. */
import type { Request } from "@authoryx/sdk";

export interface RequestView {
  requestId: string;
  state: Request["state"];
  items: { key: string; state: Request["items"][number]["state"]; usableForSeconds: number | null }[];
  awaiting: { label: string; keys: string[] }[];
  secondsLeft: number | null;
  approvalUrl: string | null;
  next: string;
}

export const PENDING_NEXT = "Show this link to your person; they approve or deny there. Then call authoryx_check_request.";

const secondsUntil = (iso: string | null, now: number) => (iso ? Math.max(0, Math.round((Date.parse(iso) - now) / 1000)) : null);

function nextSentence(r: Request): string {
  const keys = (s: string) => r.items.filter((i) => i.state === s).map((i) => i.keyName);
  const denied = keys("denied");
  const expired = keys("expired");
  const tail = [
    denied.length ? `Denied: ${denied.join(", ")}.` : "",
    expired.length ? `Expired: ${expired.join(", ")}.` : "",
    denied.length || expired.length ? "Those need a new request to ask again." : "",
  ]
    .filter(Boolean)
    .join(" ");
  switch (r.state) {
    case "pending":
      return PENDING_NEXT;
    case "approved":
      return [`Approved: ${keys("approved").join(", ")}. Call authoryx_run with requestId ${r.id}, then authoryx_close_request when the work is done.`, tail]
        .filter(Boolean)
        .join(" ");
    case "denied":
      return `Denied: ${denied.join(", ")}. Do not ask again for the same reason; a new request is needed to ask again.`;
    case "expired":
      return tail || "Expired. Open a new request with authoryx_request_access if the work still needs these secrets.";
    case "closed":
      return "Closed. Open a new request to use these secrets again.";
  }
}

export function toView(r: Request, now = Date.now()): RequestView {
  return {
    requestId: r.id,
    state: r.state,
    items: r.items.map((i) => ({ key: i.keyName, state: i.state, usableForSeconds: i.state === "approved" ? secondsUntil(i.usableUntil, now) : null })),
    awaiting: r.state === "pending" ? r.awaiting.map((a) => ({ label: a.label, keys: a.keyNames })) : [],
    secondsLeft: r.state === "pending" ? secondsUntil(r.expiresAt, now) : null,
    approvalUrl: r.state === "pending" ? r.approvalUrl : null,
    next: nextSentence(r),
  };
}
