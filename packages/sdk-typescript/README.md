# authoryxos — TypeScript SDK

```bash
npm install authoryxos
```

```ts
import { Client } from "authoryxos";

const c = new Client({
  apiKey: "axos_live_xxxxxxxxxxxxxxxxxxxx",
  baseUrl: "http://localhost:8787",
});

const secret = await c.fetch({ key: "TEST_KEY", intent: "testing the SDK" });
console.log(secret.reveal());
```

Injected-execution pattern (the secret never escapes the callback):

```ts
await c.withSecret({
  key: "DB_PASSWORD",
  intent: "Running migration for deploy job #441.",
  exec: async (s) => runMigration(s),
});
```

`SecretStr` is opaque to `console.log`, `JSON.stringify`, template literals,
and Node's `util.inspect`. The pause/resume store (`~/.authoryxos/pause.db`)
is schema-compatible with the Python SDK — a Node process can resume a
pending request a Python process started, and vice versa.

See `docs/protocol-spec.md` and `docs/architecture.md` in the repo root.
