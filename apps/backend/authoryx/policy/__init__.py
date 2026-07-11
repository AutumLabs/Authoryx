"""Pluggable policy engine.

The agent-fetch route asks a :class:`PolicyEngine` what to do with each
intent. Swapping the engine (e.g. for an AI/anomaly reviewer in the hosted
Authoryx product) requires no protocol or SDK change — just a different
:func:`get_policy_engine` binding.
"""

from .engine import Decision, PolicyContext, PolicyEngine, get_policy_engine
from .local import LocalPolicyEngine

__all__ = [
    "Decision",
    "PolicyContext",
    "PolicyEngine",
    "LocalPolicyEngine",
    "get_policy_engine",
]
