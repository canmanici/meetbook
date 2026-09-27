"""Expo Push Notification sender service."""

import logging
import uuid
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

import httpx

from app.core.http import get_http_client

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

EXPO_PUSH_API = "https://exp.host/--/api/v2/push/send"
MAX_CHUNK_SIZE = 100  # Expo limit per request
REQUEST_TIMEOUT = 10  # seconds


@dataclass
class PushMessage:
    """A push notification to send to one or more recipients."""

    title: str
    body: str
    data: dict[str, Any] | None = None  # deep link payload e.g. {"chat_id": "..."}
    badge: int | None = None
    sound: str = "default"
    priority: str = "high"
    channel_id: str = "default"


async def send_push(
    tokens: list[str],
    message: PushMessage,
) -> dict[str, Any]:
    """Send push notifications to one or more Expo push tokens.

    Returns:
        {"ok": n, "errors": [...], "invalid_tokens": [...]} summary of results.
        ``invalid_tokens`` are tokens Expo reported as DeviceNotRegistered
        (app uninstalled / token rotated) — callers should delete them.
    """
    if not tokens:
        return {"ok": 0, "errors": [], "invalid_tokens": []}

    all_ok = 0
    all_errors: list[dict[str, Any]] = []
    invalid_tokens: list[str] = []

    # Expo API accepts up to 100 messages per request
    for i in range(0, len(tokens), MAX_CHUNK_SIZE):
        chunk = tokens[i : i + MAX_CHUNK_SIZE]
        messages = [_build_expo_message(token, message) for token in chunk]

        try:
            resp = await get_http_client().post(
                EXPO_PUSH_API,
                json=messages,
                headers={
                    "Accept": "application/json",
                    "Accept-Encoding": "gzip, deflate",
                    "Content-Type": "application/json",
                },
                timeout=REQUEST_TIMEOUT,
            )
            resp.raise_for_status()
            data = resp.json()

            if isinstance(data, dict) and "data" in data:
                # Tickets come back in the same order as the messages sent.
                for token, item in zip(chunk, data["data"], strict=False):
                    if item.get("status") == "ok":
                        all_ok += 1
                        continue
                    error = (item.get("details") or {}).get("error", "unknown")
                    if error == "DeviceNotRegistered":
                        invalid_tokens.append(token)
                    all_errors.append({"token": _mask_token(token), "error": error})
            elif isinstance(data, list):
                for ticket in data:
                    if ticket.get("status") == "ok":
                        all_ok += 1

        except httpx.HTTPError as exc:
            logger.error("Expo push API request failed: %s", exc)
            all_errors.append({"error": str(exc)})
        except Exception as exc:
            logger.exception("Unexpected push send error")
            all_errors.append({"error": str(exc)})

    if all_errors:
        logger.warning("Push send: %d ok, %d errors", all_ok, len(all_errors))

    return {"ok": all_ok, "errors": all_errors, "invalid_tokens": invalid_tokens}


async def prune_invalid_tokens(session: "AsyncSession", tokens: list[str]) -> None:
    """Drop tokens Expo says are dead so we stop pushing into the void."""
    if not tokens:
        return
    from sqlalchemy import delete

    from app.modules.push_tokens.models import PushToken

    await session.execute(delete(PushToken).where(PushToken.token.in_(tokens)))
    logger.info("Pruned %d dead push token(s)", len(tokens))


async def send_push_to_users(
    user_ids: "list[uuid.UUID] | list[str]",
    message: PushMessage,
    session: "AsyncSession",
) -> dict[str, Any]:
    """Send the same push to every device of many users (one token query)."""
    from sqlalchemy import select

    from app.modules.push_tokens.models import PushToken

    if not user_ids:
        return {"ok": 0, "errors": [], "invalid_tokens": []}
    result = await session.execute(select(PushToken.token).where(PushToken.user_id.in_(user_ids)))
    tokens = [row[0] for row in result.all()]
    summary = await send_push(tokens, message)
    await prune_invalid_tokens(session, summary["invalid_tokens"])
    return summary


async def send_push_to_user(
    user_id: str,
    message: PushMessage,
    session: "AsyncSession | None" = None,  # for the device-token lookup
) -> dict[str, Any]:
    """Send push to all devices of a single user."""
    from sqlalchemy import select

    from app.modules.push_tokens.models import PushToken

    if session is None:
        logger.warning("send_push_to_user called without DB session")
        return {"ok": 0, "errors": [{"error": "no session"}], "invalid_tokens": []}

    result = await session.execute(select(PushToken.token).where(PushToken.user_id == user_id))
    tokens = [row[0] for row in result.all()]

    if not tokens:
        return {"ok": 0, "errors": [], "invalid_tokens": []}

    summary = await send_push(tokens, message)
    await prune_invalid_tokens(session, summary["invalid_tokens"])
    return summary


def _build_expo_message(token: str, message: PushMessage) -> dict[str, Any]:
    msg: dict[str, Any] = {
        "to": token,
        "title": message.title,
        "body": message.body,
        "sound": message.sound,
        "priority": message.priority,
    }
    if message.data:
        msg["data"] = message.data
    if message.badge is not None:
        msg["badge"] = message.badge
    if message.channel_id:
        # The app creates both 'default' and 'calls' channels on Android.
        msg["channelId"] = message.channel_id
    return msg


def _mask_token(token: str) -> str:
    if len(token) > 12:
        return token[:8] + "..." + token[-4:]
    return token
