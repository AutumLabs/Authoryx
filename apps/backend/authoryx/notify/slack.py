"""Slack notifier — posts an approval prompt to an incoming-webhook URL."""

from __future__ import annotations

import httpx

from ..core.config import settings
from .base import Notification


class SlackNotifier:
    def notify_pending(self, n: Notification) -> None:
        text = (
            f":lock: *AuthoryxOS approval needed*\n"
            f"*Key:* `{n.key_name}`  *Agent:* `{n.agent_id}`\n"
            f"*Intent:* {n.intent}\n"
            f"<{n.approve_url}|Review in dashboard>"
        )
        httpx.post(
            settings.notify_slack_webhook_url,
            json={"text": text},
            timeout=10,
        )
