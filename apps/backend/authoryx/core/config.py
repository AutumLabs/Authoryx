"""Typed, validated settings for the AuthoryxOS backend.

All settings are read from the environment (prefix ``AUTHORYX_``) or a
``.env`` file. Import :data:`settings` anywhere. In ``prod`` mode the
master encryption key is mandatory and the app refuses to start without it.
"""

from __future__ import annotations

import secrets as _secrets
from functools import lru_cache
from typing import Literal

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="AUTHORYX_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # ── Environment ──────────────────────────────────────────────────────────
    env: Literal["dev", "prod", "test"] = "dev"

    # ── Database ─────────────────────────────────────────────────────────────
    # SQLite for zero-dep local dev; Postgres for production. Switch by URL only.
    database_url: str = "sqlite:///./authoryxos.db"

    # ── Crypto ───────────────────────────────────────────────────────────────
    # 64 hex chars = 32 bytes. Wraps per-secret data-encryption keys.
    # Mandatory in prod; auto-generated (ephemeral) in dev/test if unset.
    master_key: str = ""

    # ── Protocol tunables ────────────────────────────────────────────────────
    clock_skew_seconds: int = 5 * 60
    pending_ttl_seconds: int = 60 * 60
    poll_interval_seconds: int = 5
    nonce_retention_seconds: int = 10 * 60

    # ── Policy ───────────────────────────────────────────────────────────────
    # Dev convenience: when true, every request is auto-approved (mirrors the
    # old mock backend). Ignored in prod.
    auto_approve: bool = False
    # Default policy applied when neither the request hint nor the agent/secret
    # specifies one.
    default_policy: Literal["approve_once", "always_approve", "require_approval"] = (
        "require_approval"
    )

    # ── Dashboard ────────────────────────────────────────────────────────────
    dashboard_enabled: bool = True
    # Owner login password for the dashboard. If empty in dev a default is used.
    owner_password: str = ""
    session_secret: str = ""
    # Public base URL used to build approve/deny links in notifications.
    public_url: str = "http://localhost:8787"

    # ── Notifications (all optional; no-op if unset) ───────────────────────────
    notify_webhook_url: str = ""
    notify_webhook_secret: str = ""
    notify_slack_webhook_url: str = ""
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = "authoryxos@localhost"
    notify_email_to: str = ""

    # ── CORS ─────────────────────────────────────────────────────────────────
    cors_origins: str = "*"

    @model_validator(mode="after")
    def _finalize(self) -> "Settings":
        if self.env == "prod":
            if not self.master_key:
                raise ValueError(
                    "AUTHORYX_MASTER_KEY is required in prod "
                    "(generate with: openssl rand -hex 32)."
                )
            if not self.session_secret and self.dashboard_enabled:
                raise ValueError(
                    "AUTHORYX_SESSION_SECRET is required in prod when the "
                    "dashboard is enabled (generate with: openssl rand -hex 32)."
                )
            if not self.owner_password and self.dashboard_enabled:
                raise ValueError(
                    "AUTHORYX_OWNER_PASSWORD is required in prod when the "
                    "dashboard is enabled."
                )
        else:
            # Dev/test: fill in ephemeral secrets so the app just runs.
            if not self.master_key:
                self.master_key = _secrets.token_hex(32)
            if not self.session_secret:
                self.session_secret = _secrets.token_hex(32)
            if not self.owner_password:
                self.owner_password = "owner"
        return self

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def auto_approve_effective(self) -> bool:
        """Auto-approve only ever applies outside prod."""
        return self.auto_approve and self.env != "prod"


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
