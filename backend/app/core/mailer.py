"""Outgoing email over SMTP (stdlib smtplib, run in a worker thread).

Provider-agnostic: configure SMTP_* env vars. With no SMTP_HOST configured
nothing is sent — the message is logged so local development still works.
"""

import asyncio
import logging
import smtplib
import ssl
from email.message import EmailMessage

from app.core.config import get_settings

logger = logging.getLogger(__name__)


class MailError(Exception):
    pass


def _send_sync(msg: EmailMessage) -> None:
    s = get_settings()
    if s.smtp_ssl:
        server: smtplib.SMTP = smtplib.SMTP_SSL(
            s.smtp_host, s.smtp_port, timeout=20, context=ssl.create_default_context()
        )
    else:
        server = smtplib.SMTP(s.smtp_host, s.smtp_port, timeout=20)
    with server:
        if s.smtp_starttls and not s.smtp_ssl:
            server.starttls(context=ssl.create_default_context())
        if s.smtp_user:
            server.login(s.smtp_user, s.smtp_password)
        server.send_message(msg)


async def send_mail(to: str, subject: str, text: str, html: str | None = None) -> bool:
    """Send an email. Returns True if handed to the SMTP server.

    Never raises for delivery problems — callers are request handlers that
    must not 500 because a mail server hiccuped; failures are logged.
    """
    s = get_settings()
    if not s.mail_enabled:
        logger.warning("MAIL NOT SENT (SMTP not configured) to=%s subject=%s\n%s", to, subject, text)
        return False
    msg = EmailMessage()
    msg["From"] = s.smtp_from
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(text)
    if html:
        msg.add_alternative(html, subtype="html")
    try:
        await asyncio.to_thread(_send_sync, msg)
        return True
    except Exception:
        logger.exception("Failed to send mail to=%s subject=%s", to, subject)
        return False


def code_email(title: str, intro: str, code: str, minutes: int) -> tuple[str, str]:
    """(text, html) for a one-time-code email, in Turkish."""
    text = (
        f"{title}\n\n{intro}\n\nKodun: {code}\n\n"
        f"Bu kod {minutes} dakika geçerlidir. Bu isteği sen yapmadıysan bu e-postayı yok sayabilirsin.\n\n— MeetBook"
    )
    html = f"""<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:480px;margin:auto;padding:24px;color:#1f2937">
  <h2 style="margin:0 0 12px">{title}</h2>
  <p style="margin:0 0 20px;line-height:1.5">{intro}</p>
  <div style="font-size:32px;letter-spacing:8px;font-weight:700;background:#f3f4f6;border-radius:12px;padding:16px;text-align:center">{code}</div>
  <p style="margin:20px 0 0;font-size:13px;color:#6b7280">Bu kod {minutes} dakika geçerlidir. Bu isteği sen yapmadıysan bu e-postayı yok sayabilirsin.</p>
  <p style="margin:16px 0 0;font-size:13px;color:#6b7280">— MeetBook</p>
</div>"""
    return text, html
