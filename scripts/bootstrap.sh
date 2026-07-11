#!/usr/bin/env bash
# AuthoryxOS one-shot setup.
#
# Generates secrets into .env (if missing), builds and starts the stack,
# waits for health, mints an admin API key, and prints how to use it.
set -euo pipefail

cd "$(dirname "$0")/.."

gen() { openssl rand -hex 32; }

if [ ! -f .env ]; then
  echo "→ Generating .env with fresh secrets…"
  cp .env.example .env
  # Portable in-place edit (macOS/BSD and GNU sed).
  sed_i() { if sed --version >/dev/null 2>&1; then sed -i "$@"; else sed -i '' "$@"; fi; }
  sed_i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(gen)|" .env
  sed_i "s|^AUTHORYX_MASTER_KEY=.*|AUTHORYX_MASTER_KEY=$(gen)|" .env
  sed_i "s|^AUTHORYX_SESSION_SECRET=.*|AUTHORYX_SESSION_SECRET=$(gen)|" .env
  OWNER_PW=$(openssl rand -hex 12)
  sed_i "s|^AUTHORYX_OWNER_PASSWORD=.*|AUTHORYX_OWNER_PASSWORD=$OWNER_PW|" .env
  echo "  Dashboard owner password: $OWNER_PW  (saved in .env)"
else
  echo "→ .env already exists; leaving it as-is."
fi

echo "→ Building and starting the stack…"
docker compose up -d --build

echo -n "→ Waiting for the backend to become healthy"
for _ in $(seq 1 60); do
  if curl -fsS http://localhost:8787/health >/dev/null 2>&1; then
    echo " ✓"
    break
  fi
  echo -n "."
  sleep 2
done

echo "→ Minting an admin API key…"
docker compose exec -T backend authoryx-backend seed

cat <<'EOF'

────────────────────────────────────────────────────────────
AuthoryxOS is up.

  Dashboard : http://localhost:8787/dashboard   (owner password in .env)
  API       : http://localhost:8787
  Health    : http://localhost:8787/health

Use the admin API key printed above as AUTHORYXOS_API_KEY for the CLI/SDK:

  export AUTHORYXOS_API_KEY=axos_live_…
  export AUTHORYXOS_BASE_URL=http://localhost:8787
  authoryxos migrate --dry-run         # preview moving secrets out of a repo
────────────────────────────────────────────────────────────
EOF
