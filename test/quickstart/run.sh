#!/usr/bin/env bash
# The README's quickstart in a clean directory (AC-048, AC-053): pack the
# packages, install them where nothing else is installed, start the stand-in
# API, and follow the README's steps to a program run with an approved secret.
# CI runs this in a fresh node container; locally: bash test/quickstart/run.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="$(mktemp -d)"
trap 'kill "${API_PID:-0}" 2>/dev/null || true; rm -rf "$WORK"' EXIT

cd "$ROOT"
[ -d packages/mcp/dist ] || { npm ci && npm run build; }
mkdir -p "$WORK/pkgs"
for w in @authoryx/sdk @authoryx/core authoryx @authoryx/mcp; do npm pack -w "$w" --pack-destination "$WORK/pkgs" >/dev/null; done

node --import tsx test/fake-agent-api/bin.ts --auto-approve > "$WORK/api.json" &
API_PID=$!
for _ in $(seq 50); do [ -s "$WORK/api.json" ] && break; sleep 0.2; done
read_json() { node -e "process.stdout.write(String(JSON.parse(require('fs').readFileSync('$WORK/api.json','utf8'))['$1']))"; }

cd "$WORK"
npm init -y >/dev/null
npm install --no-audit --no-fund ./pkgs/*.tgz >/dev/null

# Step 2 without a keychain: the environment.
export AUTHORYX_API_URL="$(read_json url)" AUTHORYX_AGENT_ID="$(read_json agentId)" AUTHORYX_AGENT_KEY="$(read_json agentKey)"
npx authoryx whoami

# Step 3: ask, then run with the approved request.
ID="$(npx authoryx request Deploy API_TOKEN --reason "quickstart" --wait 10 --json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write(JSON.parse(s).requestId))")"
OUT="$(npx authoryx run --request "$ID" --key API_TOKEN -- node -e 'console.log(process.env.API_TOKEN ? "got " + process.env.API_TOKEN : "missing")')"
echo "$OUT"
[[ "$OUT" == "got [redacted:API_TOKEN]" ]] || { echo "quickstart: expected a redacted run"; exit 1; }
npx authoryx close "$ID"

# The one-command MCP start answers a tool list.
node "$ROOT/test/quickstart/mcp-list.mjs" npx authoryx-mcp
echo "quickstart: passed"
