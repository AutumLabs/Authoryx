"""AuthoryxOS plugin for Hermes Agent.

Two ways to wire it up.

1. Auto-registration: import the package once at Hermes startup.
   `authoryxos_hermes.register()` is idempotent and registers the
   `authoryxos_fetch_secret` tool with `hermes.tools.registry` if the
   module is importable.

2. Manual: import `handler`, `SCHEMA`, `NAME`, `DESCRIPTION` and feed
   them into whatever registration layer the host wants. Useful for
   embedding into a custom Hermes fork or another Python agent
   framework with a similar shape.
"""

from __future__ import annotations

from .runtime import PluginConfig, attach, client, configure, configure_from_env
from .tool import DESCRIPTION, NAME, SCHEMA, check, handler

__all__ = [
    "register",
    "PluginConfig",
    "configure",
    "configure_from_env",
    "client",
    "attach",
    "NAME",
    "DESCRIPTION",
    "SCHEMA",
    "handler",
    "check",
]

__version__ = "0.1.0"

_registered = False


def register(*, toolset: str = "authoryxos", override: bool = False) -> bool:
    """Register `authoryxos_fetch_secret` with `hermes.tools.registry`.

    Returns True if registration happened, False if Hermes is not
    installed (in which case the plugin is still usable directly via
    the exported `handler` and `SCHEMA`).
    """
    global _registered
    if _registered and not override:
        return True
    try:
        from hermes.tools import registry  # type: ignore[import-not-found]
    except ImportError:
        return False

    registry.register(
        name=NAME,
        toolset=toolset,
        schema=SCHEMA,
        handler=handler,
        check_fn=check,
        requires_env=["AUTHORYXOS_API_KEY"],
        is_async=True,
        description=DESCRIPTION,
        override=override,
    )
    _registered = True
    return True
