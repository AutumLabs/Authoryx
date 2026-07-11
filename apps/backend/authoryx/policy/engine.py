"""Policy engine interface and the binding used by the app.

A :class:`PolicyEngine` maps a :class:`PolicyContext` to a :class:`Decision`.
The decision drives whether a fetch is auto-approved, routed to a human, or
denied outright, and reports the ``effective_policy`` surfaced to the client.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Protocol

Action = Literal["auto_approve", "require_human", "deny"]
Policy = Literal["approve_once", "always_approve", "require_approval"]


@dataclass(frozen=True)
class PolicyContext:
    """Everything the engine may consider for one intent request."""

    tenant_id: str
    agent_id: str
    key_name: str
    intent: str
    intent_hash: str
    policy_hint: Policy | None
    agent_default_policy: Policy | None
    secret_default_policy: Policy | None
    agent_require_approval: bool
    has_standing_approval: bool


@dataclass(frozen=True)
class Decision:
    action: Action
    effective_policy: Policy
    reason: str = ""


class PolicyEngine(Protocol):
    def evaluate(self, ctx: PolicyContext) -> Decision: ...


# ── Binding ──────────────────────────────────────────────────────────────────
# Default is the local engine. A managed deployment can override this.

_engine: PolicyEngine | None = None


def set_policy_engine(engine: PolicyEngine) -> None:
    global _engine
    _engine = engine


def get_policy_engine() -> PolicyEngine:
    global _engine
    if _engine is None:
        from .local import LocalPolicyEngine

        _engine = LocalPolicyEngine()
    return _engine
