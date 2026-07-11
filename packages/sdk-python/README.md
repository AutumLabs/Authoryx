# authoryxos — Python SDK

```bash
pip install authoryxos
```

```python
from authoryxos import Client

c = Client(api_key="axos_live_xxxxxxxxxxxxxxxxxxxx",
           base_url="http://localhost:8787")

secret = c.fetch(key="TEST_KEY", intent="testing the SDK")
```

For the injected-execution pattern that never assigns the secret to a variable:

```python
import asyncio
from authoryxos import AsyncClient

async def main():
    ac = AsyncClient(api_key="axos_live_…", base_url="http://localhost:8787")
    await ac.with_secret(
        key="DB_PASSWORD",
        intent="Running migration for deploy job #441.",
        exec=lambda s: run_migration(s),
    )

asyncio.run(main())
```

See `docs/protocol-spec.md` and `docs/architecture.md` in the repo root.
