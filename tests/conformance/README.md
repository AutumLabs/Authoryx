# AuthoryxOS protocol conformance suite

Any backend that wants to claim Authoryx-protocol compatibility runs this
suite against itself over HTTP. It drives the real wire protocol, not an
in-process `TestClient`, so it validates any implementation.

## Run

Point it at a running backend and give it an **admin-scoped** API key:

```bash
AUTHORYXOS_BASE_URL=http://localhost:8787 \
AUTHORYXOS_ADMIN_KEY=axos_live_… \
  pytest tests/conformance/
```

or, from the repo root:

```bash
AUTHORYXOS_BASE_URL=http://localhost:8787 AUTHORYXOS_ADMIN_KEY=axos_live_… make conformance
```

If `AUTHORYXOS_ADMIN_KEY` is unset or the backend is unreachable, the suite
skips rather than fails.

## Coverage

- Invalid API key (`invalid_api_key`).
- Unknown key (`unknown_key`).
- Clock-skew rejection (`clock_skew`).
- Replayed nonce (`replayed_nonce`).
- Pending → owner approve (returns the secret).
- Pending → owner deny (`denied` with reason).
- Audit record shape (required fields per `docs/protocol-spec.md` §3.5).

A backend that passes every case may claim Authoryx-protocol compatibility
(`docs/protocol-spec.md` §9).
