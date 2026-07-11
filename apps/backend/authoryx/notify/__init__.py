"""Operator notifications, dispatched when a request needs a human decision.

All channels are optional and configured via settings; with nothing
configured the notifier is a silent no-op (correct for local dev). The
interface is pluggable so a managed deployment can swap in push, SMS, etc.
"""

from .base import Notification, Notifier, get_notifier

__all__ = ["Notification", "Notifier", "get_notifier"]
