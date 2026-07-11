"""Pydantic request/response models for the API layer."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

Policy = Literal["approve_once", "always_approve", "require_approval"]


class IntentRequest(BaseModel):
    api_key: str = ""
    key_name: str = ""
    intent: str = Field(min_length=1, max_length=4096)
    agent_id: str = Field(max_length=128)
    session_id: str = Field(max_length=128)
    nonce: str
    timestamp: str
    policy_hint: Policy | None = None


class DecisionBody(BaseModel):
    decision: Literal["approve", "deny"]
    reason: str | None = None


class SecretUpsert(BaseModel):
    key_name: str
    value: str = Field(min_length=1, max_length=65536)
    description: str = ""
    default_policy: Policy | None = None
    source: str = ""


class AgentRegister(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    description: str = ""
    allowed_keys: list[str] = Field(default_factory=list)
    external_id: str | None = None
    require_approval: bool = True
    default_policy: Policy = "require_approval"


class ApiKeyIssue(BaseModel):
    label: str = ""
    scope: Literal["agent", "admin"] = "agent"
    allowed_keys: list[str] = Field(default_factory=list)
