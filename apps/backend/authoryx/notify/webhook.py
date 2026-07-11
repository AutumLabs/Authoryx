"""Webhook notifier — POSTs an HMAC-signed JSON payload to a configured URL."""

from __future__ import annotations

import hashlib
import hmac
import json

import httpx

from ..core.config import settings
from .base import Notification


class WebhookNotifier:
    def notify_pending(self, n: Notification) -> None:
        payload = {
            "event": "secret.pending",
            "token": n.token,
            "key_name": n.key_name,
            "agent_id": n.agent_id,
            "intent": n.intent,
            "approve_url": n.approve_url,
        }
        body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        headers = {"Content-Type": "application/json"}
        if settings.notify_webhook_secret:
            sig = hmac.new(
                settings.notify_webhook_secret.encode("utf-8"), body, hashlib.sha256
            ).hexdigest()
            headers["X-Authoryx-Signature"] = f"sha256={sig}"
        httpx.post(settings.notify_webhook_url, content=body, headers=headers, timeout=10)
