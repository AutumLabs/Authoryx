#!/bin/sh
# Apply migrations, ensure a default tenant exists, then serve.
set -e

echo "[authoryx] running migrations…"
alembic upgrade head

# Ensure a default tenant + demo secret exist (idempotent; no key minted here —
# mint an admin key explicitly with: authoryx-backend seed).
echo "[authoryx] ensuring default tenant…"
authoryx-backend seed --no-key || true

echo "[authoryx] starting API on :${AUTHORYX_PORT:-8787}"
exec uvicorn authoryx.main:app --host 0.0.0.0 --port "${AUTHORYX_PORT:-8787}"
