/** What the command-line tool touches outside itself, injectable so tests run it in-process. */
import { createInterface } from "node:readline";
import type { KeyStore } from "@authoryx/core";

export interface Out {
  write(s: string): unknown;
  isTTY?: boolean;
}

export interface Io {
  stdout: Out;
  stderr: Out;
  stdin: NodeJS.ReadableStream & { isTTY?: boolean };
  env: NodeJS.ProcessEnv;
  /** Defaults to the OS keychain. */
  store?: KeyStore;
  /** Defaults to <config dir>/authoryx/config.json. */
  settingsFile?: string;
  /** Asks a question on the terminal; hidden input for the key. */
  prompt?: (question: string, hidden: boolean) => Promise<string>;
  /** Home directory, for the host's settings file. */
  home?: string;
  cwd?: string;
  pollMs?: number;
}

/** A terminal prompt; with `hidden`, typed characters are not echoed. */
export function terminalPrompt(io: Pick<Io, "stdin" | "stderr">) {
  return (question: string, hidden: boolean) =>
    new Promise<string>((resolve, reject) => {
      const rl = createInterface({ input: io.stdin, output: io.stderr as NodeJS.WritableStream, terminal: true });
      if (hidden) {
        const r = rl as unknown as { _writeToOutput: (s: string) => void };
        r._writeToOutput = (s: string) => {
          if (s.includes(question)) io.stderr.write(s);
        };
      }
      rl.question(question, (answer) => {
        rl.close();
        if (hidden) io.stderr.write("\n");
        resolve(answer.trim());
      });
      rl.on("SIGINT", () => {
        rl.close();
        reject(new Error("cancelled"));
      });
    });
}

/** The first line of standard input, for a key piped in. */
export async function firstLine(stdin: NodeJS.ReadableStream): Promise<string> {
  let data = "";
  for await (const chunk of stdin) {
    data += chunk.toString();
    if (data.includes("\n")) break;
  }
  return (data.split(/\r?\n/)[0] ?? "").trim();
}
