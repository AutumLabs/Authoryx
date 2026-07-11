/**
 * Holds a secret string without exposing it through `toString`, `console.log`,
 * `JSON.stringify`, or template literals. Call `.reveal()` to get the raw value.
 */
export class SecretStr {
  #value: string;

  constructor(value: string) {
    if (typeof value !== "string") throw new TypeError("SecretStr requires a string");
    this.#value = value;
  }

  reveal(): string {
    return this.#value;
  }

  toString(): string {
    return "***";
  }

  toJSON(): string {
    return "***";
  }

  /** Best-effort: drop the reference so the GC can reclaim the buffer. */
  zero(): void {
    this.#value = "";
  }
}

// Hide from Node's default util.inspect.
const inspect = Symbol.for("nodejs.util.inspect.custom");
(SecretStr.prototype as unknown as { [inspect]: () => string })[inspect] = () =>
  "SecretStr(***)";
