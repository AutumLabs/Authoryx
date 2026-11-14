/**
 * Exact output redaction (FR-010).
 *
 * The redactor holds the literal secret values that are live for one
 * `run` invocation and removes every occurrence of them from a child
 * process's stdout and stderr before that output is handed back to an agent.
 *
 * This is the *only* place the removal can be exact. A downstream redactor —
 * a Claude Code hook, a log filter — has to pattern-match on what a credential
 * looks like, so it misses anything the wrapped tool re-encoded on the way out
 * (`curl -v` base64-ing an Authorization header, a JSON API echoing the key
 * back with escapes). Here we know the byte sequence we are looking for, so we
 * can also look for its encoded forms.
 *
 * Fail-safe direction: when in doubt, redact. A noisy transcript is a
 * recoverable problem; a leaked credential is not.
 */

import { StringDecoder } from "node:string_decoder";

/**
 * Values shorter than this cannot be redacted without destroying the
 * surrounding output — and the redaction pattern itself would disclose where
 * the value occurs. We still redact them (never silently pass a secret
 * through), but the caller is warned so the underlying short credential can be
 * fixed.
 */
export const MIN_SAFE_SECRET_LENGTH = 6;

/** Rendered in place of a redacted value. */
export function redactionToken(keyName: string): string {
  return `[redacted:${keyName}]`;
}

interface Needle {
  readonly text: string;
  readonly keyName: string;
}

/** Standard base64, with and without `=` padding. */
function base64Variants(value: string): string[] {
  const b64 = Buffer.from(value, "utf8").toString("base64");
  const url = b64.replace(/\+/g, "-").replace(/\//g, "_");
  return [b64, b64.replace(/=+$/, ""), url, url.replace(/=+$/, "")];
}

/**
 * Every serialization of `value` a wrapped tool might plausibly emit.
 *
 * Deliberately over-inclusive. A variant that never appears costs one failed
 * string comparison per input position; a variant we omitted costs a leak.
 */
export function encodedVariants(value: string): string[] {
  const out = new Set<string>([value]);

  for (const b of base64Variants(value)) out.add(b);

  // Percent-encoding: the full form, and the laxer form emitted by encodeURI
  // (which leaves reserved characters alone).
  out.add(encodeURIComponent(value));
  out.add(encodeURI(value));

  // JSON string escaping, minus the surrounding quotes — what a value looks
  // like inside a JSON response body.
  out.add(JSON.stringify(value).slice(1, -1));

  // Hex, both cases.
  const hex = Buffer.from(value, "utf8").toString("hex");
  out.add(hex);
  out.add(hex.toUpperCase());

  // Anything that collapsed back to the raw value is already in the set.
  return [...out].filter((v) => v.length > 0);
}

export class Redactor {
  /** keyName → raw value, kept so `zero()` can clear them. */
  readonly #values = new Map<string, string>();
  /** All needles, longest first, so the most specific match wins. */
  #needles: Needle[] = [];
  /** First character → needles starting with it. Avoids scanning all needles per position. */
  #byFirstChar = new Map<string, Needle[]>();
  #maxNeedleLength = 0;

  /** Values shorter than MIN_SAFE_SECRET_LENGTH, reported so callers can warn. */
  readonly shortValues: string[] = [];

  /** How many occurrences have been removed so far. */
  removals = 0;

  /**
   * Register a secret value under the key name it was fetched as.
   * Values are matched literally and in their encoded forms.
   */
  add(keyName: string, value: string): void {
    if (!value) return;
    this.#values.set(keyName, value);
    if (value.length < MIN_SAFE_SECRET_LENGTH && !this.shortValues.includes(keyName)) {
      this.shortValues.push(keyName);
    }
    this.#rebuild();
  }

  #rebuild(): void {
    const seen = new Map<string, string>();
    for (const [keyName, value] of this.#values) {
      for (const variant of encodedVariants(value)) {
        // If two secrets produce the same needle, the first registration wins;
        // the token is only a label, and either label is honest.
        if (!seen.has(variant)) seen.set(variant, keyName);
      }
    }
    this.#needles = [...seen.entries()]
      .map(([text, keyName]) => ({ text, keyName }))
      .sort((a, b) => b.text.length - a.text.length);

    this.#byFirstChar = new Map();
    this.#maxNeedleLength = 0;
    for (const n of this.#needles) {
      const c = n.text[0] as string;
      const bucket = this.#byFirstChar.get(c);
      if (bucket) bucket.push(n);
      else this.#byFirstChar.set(c, [n]);
      if (n.text.length > this.#maxNeedleLength) this.#maxNeedleLength = n.text.length;
    }
  }

  /** Longest needle currently registered. Streams need this for their overlap window. */
  get maxNeedleLength(): number {
    return this.#maxNeedleLength;
  }

  get isEmpty(): boolean {
    return this.#needles.length === 0;
  }

  /**
   * Replace every occurrence of every registered value (and its encoded forms)
   * with a redaction token.
   *
   * Single left-to-right scan rather than one `replaceAll` pass per needle:
   * a replaced region is never re-examined, so one secret's value cannot be
   * matched inside the token emitted for another.
   */
  redact(text: string): string {
    return this.scan(text, text.length).out;
  }

  /**
   * Scan `text`, stopping once the read position reaches `stopAt`.
   *
   * Returns what was resolved and how much input it consumed. A match that
   * begins before `stopAt` is always completed, so `consumed` never lands in
   * the middle of a match — which is the property the streaming wrapper needs
   * to hold back a tail without ever splitting a secret in half.
   */
  scan(text: string, stopAt: number): { out: string; consumed: number } {
    if (this.#needles.length === 0 || text.length === 0) {
      const consumed = Math.max(0, Math.min(stopAt, text.length));
      return { out: text.slice(0, consumed), consumed };
    }
    let out = "";
    let i = 0;
    const n = text.length;
    const limit = Math.min(stopAt, n);
    while (i < limit) {
      const candidates = this.#byFirstChar.get(text[i] as string);
      let matched: Needle | undefined;
      if (candidates) {
        for (const c of candidates) {
          if (c.text.length <= n - i && text.startsWith(c.text, i)) {
            matched = c;
            break; // candidates inherit the longest-first ordering
          }
        }
      }
      if (matched) {
        this.removals += 1;
        out += redactionToken(matched.keyName);
        i += matched.text.length;
      } else {
        out += text[i];
        i += 1;
      }
    }
    return { out, consumed: i };
  }

  /** Drop every registered value. Called once the child process has exited. */
  zero(): void {
    this.#values.clear();
    this.#needles = [];
    this.#byFirstChar = new Map();
    this.#maxNeedleLength = 0;
  }
}

/**
 * Streaming wrapper around a Redactor.
 *
 * A secret can straddle a chunk boundary — `sk_li` at the end of one read and
 * `ve_abc` at the start of the next — so the stream holds back the last
 * `maxNeedleLength - 1` characters of every chunk and re-examines them with the
 * next one. Without that window, chunked output leaks at exactly the
 * boundaries an attacker can provoke by controlling output size.
 *
 * Bytes are decoded through a StringDecoder so a multi-byte UTF-8 sequence
 * split across reads is not corrupted into a false non-match.
 */
export class RedactingStream {
  readonly #redactor: Redactor;
  readonly #decoder = new StringDecoder("utf8");
  #pending = "";

  constructor(redactor: Redactor) {
    this.#redactor = redactor;
  }

  /** Feed a chunk; returns the safe-to-emit, redacted prefix. */
  push(chunk: Buffer | string): string {
    const text =
      typeof chunk === "string" ? chunk : this.#decoder.write(chunk);
    if (!text) return "";
    this.#pending += text;

    const hold = Math.max(0, this.#redactor.maxNeedleLength - 1);
    if (this.#pending.length <= hold) return "";

    // Scan the whole buffer but stop reading at `cut`. A match starting before
    // `cut` is at most `maxNeedleLength` long, so it is fully contained in
    // `pending` and gets resolved; the scan then hands back a `consumed` offset
    // that is guaranteed not to sit inside a match.
    const cut = this.#pending.length - hold;
    const { out, consumed } = this.#redactor.scan(this.#pending, cut);
    this.#pending = this.#pending.slice(consumed);
    return out;
  }

  /** Flush the held-back tail. Call once the source stream has ended. */
  flush(): string {
    this.#pending += this.#decoder.end();
    const rest = this.#pending;
    this.#pending = "";
    return this.#redactor.redact(rest);
  }
}
