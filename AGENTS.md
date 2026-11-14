# AGENTS.md

Context for anyone, person or coding agent, changing this repository. `CLAUDE.md` points here.

## What this is

The open-source tools an AI agent uses to work with Authoryx: an agent asks to use secrets shared
into one of its circles, the secret's owner approves or denies on the Authoryx dashboard, and the
value goes to a program, never to the agent's conversation. The server and dashboard are not here;
the tools speak the agent API in [protocol/agent-api.md](protocol/agent-api.md) and nothing else.

## Layout

```text
protocol/              the agent API contract, JSON Schemas, capabilities, VERSION
packages/sdk/          @authoryx/sdk: the typed client; no runtime dependency
packages/core/         @authoryx/core: tool registry, verbs, run and redaction, sign-in
packages/cli/          authoryx: the command-line tool and the Claude Code guard hook
packages/mcp/          @authoryx/mcp: the MCP stdio server
python/authoryx-sdk/   authoryx on PyPI: the Python client; standard library only
skills/, plugins/      the agent skill and host packages (a later feature)
connectors/            T2 connectors (later; empty until a T2 feature)
test/fake-agent-api/   an in-memory stand-in for the agent API, used by every test
test/acceptance/       the built server and CLI as processes, every output searched for planted values
test/quickstart/       the README's steps from packed packages in an empty directory
docs/                  concepts, tiers, security, troubleshooting; tools.md is generated
scripts/               gen-docs.mjs (generated text) and check-docs.mjs (wording and length)
```

## Commands

```bash
npm ci              # Node 20 or newer; npm workspaces only
npm run build       # every package
npm run typecheck
npm test            # unit tests, all against test/fake-agent-api
npm run test:acceptance          # after build: nothing planted reaches what an agent sees
bash test/quickstart/run.sh      # after build: the README's steps from packed packages
npm run docs        # regenerate the tool table, docs/tools.md, capabilities.md, llms.txt
npm run check       # wording, lengths, and that generated text is current
pip install -e "python/authoryx-sdk[test]" && pytest -q python/authoryx-sdk   # Python 3.10+
```

No server, account or key is needed to develop: the stand-in API issues its own per test.

## Rules

1. **No MCP tool returns a secret's value** (ADR-0012). `run` gives values to a child program, started
   without a shell, and returns only its exit code and output with every value removed in plain,
   base64, hex, URL-encoded and JSON-escaped form. Never add a tool, flag or field that returns one.
2. **Every tool declares a tier and a capability** (ADR-0020). T1 "Out of the chat": `run` (Run with
   secrets) and `fetch` (Fetch for scripts). `fetch` is command-line and SDK only, never MCP. T2 "Out
   of the agent's hands" (web sign-in, new account, API call, new secret, export, connectors) is
   named and reserved: no T2 tool ships until a feature builds it and the dashboard can grant it.
3. **A surface offers only granted tools.** Granted = `ask`, `run`, `fetch` plus the known ids in
   `whoami.capabilities`; unknown ids are ignored.
4. **A key or value never appears** in a log, error, argument list, test fixture or commit. The agent
   key comes from the OS keychain or `AUTHORYX_AGENT_KEY`, never from an argument.
5. **Say only what is true.** Never call Authoryx or the guard end-to-end, zero-knowledge, HSM-backed <!-- check-docs: allow -->
   or a sandbox, and never say an agent cannot see a value it fetches through `fetch` or an SDK. <!-- check-docs: allow -->
   `npm run check` fails on these.
6. **One fact, one place.** Tool descriptions live in the registry; install commands and environment
   variables live in the README. Generated text is never edited by hand.

## Environment

| Variable | Meaning |
| --- | --- |
| `AUTHORYX_AGENT_ID` | the agent's id, `agt_…` |
| `AUTHORYX_AGENT_KEY` | the agent's key, `axa_…`; overrides the keychain, nothing is stored |
| `AUTHORYX_API_URL` | the Authoryx API's address |
| `AUTHORYX_DEBUG=1` | log each call's route, status and duration to stderr |

## Commits and pull requests

- Work lands through pull requests to `main`; CI must pass on macOS, Linux and Windows.
- Squash subjects are Conventional Commits with the roadmap feature id as the scope, so
  release-please can read them: `feat(F-014): add the MCP server`, `fix(F-014): …`.
  No tool or assistant attribution lines in commits or PRs.
- Releases: release-please keeps a release PR open on `main`; merging it tags one version for every
  package, and `.github/workflows/release.yml` publishes to npm and PyPI with provenance.
