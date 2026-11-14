import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { memoryKeyStore } from "@authoryx/core";
import { run, type Io } from "../src/index.ts";

export interface Captured {
  code: number;
  stdout: string;
  stderr: string;
}

export function makeIo(opts: { env?: NodeJS.ProcessEnv; stdin?: string; tty?: boolean; stdoutTTY?: boolean; answers?: string[] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "authoryx-cli-"));
  const store = memoryKeyStore();
  const stdin = Readable.from(opts.stdin !== undefined ? [opts.stdin] : []) as unknown as Io["stdin"];
  (stdin as { isTTY?: boolean }).isTTY = opts.tty ?? false;
  const answers = [...(opts.answers ?? [])];
  const prompts: { q: string; hidden: boolean }[] = [];
  const io = {
    env: opts.env ?? {},
    store,
    settingsFile: join(dir, "authoryx", "config.json"),
    home: dir,
    cwd: dir,
    pollMs: 20,
    stdin,
    prompts,
    prompt: async (q: string, hidden: boolean) => {
      prompts.push({ q, hidden });
      return answers.shift() ?? "";
    },
  };
  const exec = async (...argv: string[]): Promise<Captured> => {
    let stdout = "";
    let stderr = "";
    const code = await run(argv, {
      ...io,
      stdout: { write: (s: string) => (stdout += s), isTTY: opts.stdoutTTY ?? false },
      stderr: { write: (s: string) => (stderr += s) },
    });
    return { code, stdout, stderr };
  };
  return { io, store, dir, exec };
}
