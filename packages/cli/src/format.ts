/** Readable output for people at a terminal; `--json` prints the same data as one document instead. */
import type { RequestView } from "@authoryx/core";
import type { Circle, Share, SharedVault } from "@authoryx/sdk";

export function table(head: string[], rows: string[][]): string {
  if (!rows.length) return "";
  const w = head.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)));
  const line = (r: string[]) => r.map((c, i) => (i === r.length - 1 ? c : c.padEnd(w[i] as number))).join("  ").trimEnd();
  return [line(head), ...rows.map(line)].join("\n") + "\n";
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export function circles(cs: Circle[]): string {
  if (!cs.length) return "This agent is not attached to any circle yet. Attach it on its page in the Authoryx dashboard.\n";
  return table(["ID", "NAME", "DESCRIPTION"], cs.map((c) => [c.id, c.name, c.description ?? ""]));
}

function access(s: Share): string {
  if (s.access.state === "allowed") return `allowed until ${s.access.until} (request ${s.access.requestId})`;
  if (s.access.state === "ask") return s.access.pendingRequestId ? `ask (waiting: ${s.access.pendingRequestId})` : "ask";
  return "blocked";
}

export function secrets(r: { circle: { id: string; name: string }; secrets: Share[]; vaults: SharedVault[] }): string {
  if (!r.secrets.length) return `Nothing is shared into ${r.circle.name} yet.\n`;
  return table(
    ["KEY", "NAME", "TYPE", "VAULT", "ACCESS"],
    r.secrets.map((s) => [s.keyName, s.name, s.type, s.vault?.name ?? "", access(s)]),
  );
}

export function request(v: RequestView): string {
  const keys = v.items.map((i) => `${i.key} ${i.state}`).join(", ");
  switch (v.state) {
    case "pending":
      return [
        `Request ${v.requestId} is waiting for ${v.awaiting.map((a) => `${a.label} (${a.keys.join(", ")})`).join(", ") || "an answer"}${v.secondsLeft !== null ? `, ${mmss(v.secondsLeft)} left` : ""}.`,
        `Approve or deny: ${v.approvalUrl}`,
        "",
      ].join("\n");
    case "approved":
      return `Request ${v.requestId} is approved: ${keys}.\nUse it: authoryx run --request ${v.requestId} --key <KEY> -- <program>\n`;
    case "denied":
      return `Request ${v.requestId} was denied: ${keys}. Open a new request to ask again.\n`;
    case "expired":
      return `Request ${v.requestId} expired: ${keys}. Open a new request to ask again.\n`;
    case "closed":
      return `Request ${v.requestId} is closed.\n`;
  }
}
