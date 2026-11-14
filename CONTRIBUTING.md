# Contributing

Thanks for looking. Read [AGENTS.md](AGENTS.md) first: it holds the layout, the commands and the
rules every change follows. This page covers what is specific to sending a change.

## The rule that decides most reviews

No MCP tool returns a secret's value, and no flag or option adds one. A change that would is
declined however well it is written: an agent's tool results are kept in its transcript and sent
back to the model on every later turn, so a tool that returns a value has already leaked it.

## Before you open a pull request

```bash
npm ci
npm run build && npm run typecheck && npm test && npm run check
```

- Tests run against `test/fake-agent-api`; you need no server, account or key.
- A change to the agent API's shapes starts in `protocol/` and its schemas.
- A new tool needs a tier and a capability id in the registry; T2 tools wait for a feature that
  builds them and for the dashboard to grant them.
- Error messages are read by someone in a hurry: say what went wrong and what to do, and never
  include a value, a key or anything that could be part of one.

## Style

TypeScript in `strict` mode, ES modules, no `any`. Each module has its tests in the package's
`test/`. Comments say why, not what. No linter is configured; match the code around you.

## Licence

By contributing you agree that your work is licensed under Apache-2.0, this repository's licence.
There is no contributor licence agreement.
