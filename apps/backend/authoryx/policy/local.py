"""The default, self-host policy engine.

Resolution order for the effective policy:

1. The request's ``policy_hint`` (if present).
2. The agent's ``default_policy`` (if the agent is registered).
3. The secret's ``default_policy`` (if set).
4. The backend-wide ``AUTHORYX_DEFAULT_POLICY``.

Then:

- Dev ``auto_approve`` short-circuits everything (mirrors the old mock).
- ``require_approval`` → always route to a human.
- ``always_approve`` → auto-approve iff a standing approval already exists,
  otherwise route to a human (whose approval *creates* the standing grant).
- ``approve_once`` → route to a human (unless the agent is configured not to
  require approval, in which case auto-approve this single fetch).
"""

from __future__ import annotations

from ..core.config import settings
from .engine import Decision, Policy, PolicyContext


class LocalPolicyEngine:
    def evaluate(self, ctx: PolicyContext) -> Decision:
        effective: Policy = (
            ctx.policy_hint
            or ctx.agent_default_policy
            or ctx.secret_default_policy
            or settings.default_policy
        )

        if settings.auto_approve_effective:
            return Decision("auto_approve", effective, "dev auto-approve")

        if effective == "require_approval":
            return Decision("require_human", effective)

        if effective == "always_approve":
            if ctx.has_standing_approval:
                return Decision("auto_approve", effective, "standing approval")
            return Decision("require_human", effective, "first use of standing grant")

        # approve_once
        if not ctx.agent_require_approval:
            return Decision("auto_approve", effective, "agent does not require approval")
        return Decision("require_human", effective)
