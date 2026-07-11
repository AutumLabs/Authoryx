# Hermes Agent integration

`plugins/hermes/` ships the `authoryxos-hermes` PyPI package. It exposes
one async tool — `authoryxos_fetch_secret(key, intent)` — through
Hermes's `tools.registry`.

```bash
pip install authoryxos-hermes
export AUTHORYXOS_API_KEY=axos_live_xxxxxxxxxxxxxxxxxxxx
export AUTHORYXOS_BASE_URL=http://localhost:8787  # optional
```

Hermes does not load external plugins via entry points by default — it
discovers tools by AST-scanning its own `tools/` directory. Opt in
explicitly during Hermes startup:

```python
import authoryxos_hermes
authoryxos_hermes.register()
```

`register()` is idempotent and returns `False` (no-op) when Hermes is
not importable, leaving the handler usable directly through the
package exports for embedded / custom-loader setups.

The handler, schema, name, and description mirror the OpenClaw plugin
and the Claude Code MCP plugin exactly, so retargeting to LangChain /
LlamaIndex / AutoGen / CrewAI is a thin wrapper exercise.
