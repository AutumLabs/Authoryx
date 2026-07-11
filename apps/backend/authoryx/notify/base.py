"""Notifier interface, the multiplexing default, and channel construction."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from ..core.config import settings


@dataclass(frozen=True)
class Notification:
    """A pending-approval event the owner should act on."""

    token: str
    key_name: str
    agent_id: str
    intent: str
    approve_url: str
    dashboard_url: str


class Notifier(Protocol):
    def notify_pending(self, n: Notification) -> None: ...


class MultiNotifier:
    """Fan a notification out to every configured channel; never raises.

    A channel failure is logged but must not break the agent request flow.
    """

    def __init__(self, channels: list[Notifier]) -> None:
        self._channels = channels

    def notify_pending(self, n: Notification) -> None:
        import logging

        log = logging.getLogger("authoryx.notify")
        for ch in self._channels:
            try:
                ch.notify_pending(n)
            except Exception as exc:  # pragma: no cover - defensive
                log.warning("notifier %s failed: %s", type(ch).__name__, exc)


_notifier: Notifier | None = None


def set_notifier(notifier: Notifier) -> None:
    global _notifier
    _notifier = notifier


def get_notifier() -> Notifier:
    global _notifier
    if _notifier is not None:
        return _notifier

    from .email import EmailNotifier
    from .slack import SlackNotifier
    from .webhook import WebhookNotifier

    channels: list[Notifier] = []
    if settings.notify_webhook_url:
        channels.append(WebhookNotifier())
    if settings.notify_slack_webhook_url:
        channels.append(SlackNotifier())
    if settings.smtp_host and settings.notify_email_to:
        channels.append(EmailNotifier())

    _notifier = MultiNotifier(channels)
    return _notifier
