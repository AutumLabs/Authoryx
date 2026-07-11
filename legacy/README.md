# legacy/

Reference-only scaffolds from earlier iterations. Not built, deployed, or
tested as part of AuthoryxOS, and not on any active code path.

- **The Node/TS monorepo at this directory's root** (`apps/`, `packages/`,
  `infra/`, `turbo.json`, `package.json`, …): the original `authoryx-os`
  scaffold — Fastify + Next.js + Drizzle with an SMS-relay framing. Superseded
  by the protocol-first design now at the repository root.
- **`mock-backend/`**: the original FastAPI reference backend (SQLite, env-var
  secret store, auto/manual approve). Superseded by `apps/backend/`, which adds
  encryption-at-rest, multi-tenant API keys, a policy engine, notifications,
  and an owner dashboard.

Kept for historical context. Safe to delete if you don't need it.
