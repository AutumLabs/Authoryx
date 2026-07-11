"""Email notifier — sends an approval prompt via SMTP."""

from __future__ import annotations

import smtplib
from email.message import EmailMessage

from ..core.config import settings
from .base import Notification


class EmailNotifier:
    def notify_pending(self, n: Notification) -> None:
        msg = EmailMessage()
        msg["Subject"] = f"AuthoryxOS: approval needed for {n.key_name}"
        msg["From"] = settings.smtp_from
        msg["To"] = settings.notify_email_to
        msg.set_content(
            f"An agent is requesting access to '{n.key_name}'.\n\n"
            f"Agent:  {n.agent_id}\n"
            f"Intent: {n.intent}\n\n"
            f"Review and approve or deny:\n{n.approve_url}\n"
        )
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10) as smtp:
            smtp.starttls()
            if settings.smtp_user:
                smtp.login(settings.smtp_user, settings.smtp_password)
            smtp.send_message(msg)
