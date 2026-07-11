import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

export interface PendingRow {
  token: string;
  base_url: string;
  poll_url: string;
  poll_interval: number;
  expires_at: string;
  key_name: string;
  agent_id: string;
  session_id: string;
  created_at: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS pending (
  token         TEXT PRIMARY KEY,
  base_url      TEXT NOT NULL,
  poll_url      TEXT NOT NULL,
  poll_interval INTEGER NOT NULL,
  expires_at    TEXT NOT NULL,
  key_name      TEXT NOT NULL,
  agent_id      TEXT NOT NULL,
  session_id    TEXT NOT NULL,
  created_at    TEXT NOT NULL
);
`;

export function defaultPath(): string {
  const override = process.env["AUTHORYXOS_PAUSE_DB"];
  if (override) return override;
  const root = join(homedir(), ".authoryxos");
  if (!existsSync(root)) mkdirSync(root, { recursive: true });
  return join(root, "pause.db");
}

export class PauseStore {
  #db: Database.Database;

  constructor(path?: string) {
    this.#db = new Database(path ?? defaultPath());
    this.#db.exec(SCHEMA);
  }

  save(row: PendingRow): void {
    this.#db
      .prepare(
        `INSERT OR REPLACE INTO pending
         (token, base_url, poll_url, poll_interval, expires_at, key_name,
          agent_id, session_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.token, row.base_url, row.poll_url, row.poll_interval,
        row.expires_at, row.key_name, row.agent_id, row.session_id,
        row.created_at,
      );
  }

  delete(token: string): void {
    this.#db.prepare("DELETE FROM pending WHERE token = ?").run(token);
  }

  all(): PendingRow[] {
    return this.#db.prepare("SELECT * FROM pending").all() as PendingRow[];
  }

  get(token: string): PendingRow | undefined {
    return this.#db
      .prepare("SELECT * FROM pending WHERE token = ?")
      .get(token) as PendingRow | undefined;
  }

  close(): void {
    this.#db.close();
  }
}
