"""Chat business logic + WebSocket connection manager + Redis pub/sub + presence."""

import asyncio
import json
import logging
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import redis.asyncio as aioredis
from fastapi import WebSocket
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.db import get_session_factory
from app.core.security import hash_token, generate_opaque_token
from app.modules.chat.models import Message
from app.modules.chat.repository import ChatRepository
from app.modules.chat.schemas import (
    ChatListResponse,
    ChatSettingsView,
    ChatSummary,
    MessageDeliveryInfo,
    MessageListResponse,
    MessageView,
    ReactionView,
)
from app.modules.notifications.service import NotificationService
from app.modules.push_tokens.service import PushMessage, send_push_to_user

TICKET_TTL_SECONDS = 30
MESSAGE_LIMIT = 2000
PUBSUB_RETRY_DELAY_SECONDS = 5
PRESENCE_KEY_TTL = 60  # seconds — user considered offline after 60s without ping

MUTE_DURATION_DELTAS: dict[str, timedelta | None] = {
    "1h": timedelta(hours=1),
    "8h": timedelta(hours=8),
    "1w": timedelta(weeks=1),
    "forever": None,  # NULL muted_until = muted forever
}

logger = logging.getLogger(__name__)

# Message types a CLIENT may send. Everything else (call logs, exchange
# lifecycle events, ...) is server-authored only.
CLIENT_MESSAGE_TYPES = frozenset(
    {"text", "image", "voice", "location", "location_invite", "book_card", "system"}
)
# The only system bubble a client may author (live-location accept notice).
CLIENT_SYSTEM_ACTIONS = frozenset({"location_accepted"})
# Types that carry their content in `extra` and may have empty text.
EXTRA_ONLY_TYPES = frozenset({"image", "voice", "location", "book_card"})
MAX_EXTRA_BYTES = 4096


def _validate_client_message(message_type: Any, text: str, extra: Any) -> str | None:
    """Return an error string if a client-sent message is not allowed."""
    if message_type not in CLIENT_MESSAGE_TYPES:
        return "Invalid message_type"
    if extra is not None:
        if not isinstance(extra, dict):
            return "extra must be an object"
        if len(json.dumps(extra, default=str)) > MAX_EXTRA_BYTES:
            return "extra too large"
    if message_type == "system":
        if not isinstance(extra, dict) or set(extra) != {"action"} or extra["action"] not in CLIENT_SYSTEM_ACTIONS:
            return "Clients cannot send this system message"
    if not text and not (message_type in EXTRA_ONLY_TYPES and extra):
        return "text is required"
    return None


# ---------------------------------------------------------------------------
# In-memory connection pool + Redis presence
# ---------------------------------------------------------------------------
_connections: dict[uuid.UUID, set[WebSocket]] = {}
_redis_pubsub: aioredis.Redis | None = None
_listener_task: Any = None
# Identifies this process on the shared Redis channel. Every publish is
# tagged with it so the listener can skip its own echoes — the publishing
# process has already delivered locally via broadcast_to_chat().
_INSTANCE_ID = uuid.uuid4().hex
_background_tasks: set[asyncio.Task[None]] = set()

PRESENCE_CHANNEL = "presence"


# ── Ticket helpers ─────────────────────────────────────────────────────────


async def create_ticket(user_id: uuid.UUID) -> str:
    raw = generate_opaque_token(16)
    hashed = hash_token(raw)
    r = await _get_redis()
    key = f"ws_ticket:{hashed}"
    await r.setex(key, TICKET_TTL_SECONDS, str(user_id))
    return raw


async def consume_ticket(ticket: str) -> uuid.UUID | None:
    hashed = hash_token(ticket)
    r = await _get_redis()
    key = f"ws_ticket:{hashed}"
    raw_user_id = await r.get(key)
    if raw_user_id is None:
        return None
    await r.delete(key)
    return uuid.UUID(raw_user_id.decode() if isinstance(raw_user_id, bytes) else raw_user_id)


def _to_view(
    msg: Message,
    reply_text: str | None = None,
    reply_sender_name: str | None = None,
) -> MessageView:
    return MessageView(
        id=msg.id,
        chat_id=msg.chat_id,
        sender_id=msg.sender_id,
        message_type=msg.message_type,
        text=msg.text,
        created_at=msg.created_at,
        read_at=msg.read_at,
        reply_to_id=msg.reply_to_id,
        reply_to_text=reply_text,
        reply_to_sender_name=reply_sender_name,
        starred_at=msg.starred_at,
        pinned_at=msg.pinned_at,
        extra=msg.extra,
    )


# ---------------------------------------------------------------------------
# Connection manager + Presence
# ---------------------------------------------------------------------------


class ConnectionManager:
    """Per-instance in-memory WebSocket pool with Redis-backed presence."""

    @staticmethod
    async def connect(user_id: uuid.UUID, ws: WebSocket) -> None:
        await ws.accept()
        _connections.setdefault(user_id, set()).add(ws)
        # Set online in Redis
        r = await _get_redis()
        await r.setex(f"presence:{user_id}", PRESENCE_KEY_TTL, "online")
        # Broadcast presence
        await ConnectionManager._broadcast_presence(user_id, True)

    @staticmethod
    async def on_disconnected(user_id: uuid.UUID) -> None:
        """Called after a socket closed. Only when the user's LAST local
        socket is gone do we drop the presence key — otherwise a callee who
        just closed the app looked online for up to PRESENCE_KEY_TTL, so
        incoming calls skipped the push and the offer went nowhere."""
        if _connections.get(user_id):
            return  # another device/socket of this user is still connected
        r = await _get_redis()
        await r.delete(f"presence:{user_id}")
        await ConnectionManager.set_last_seen(user_id)
        await ConnectionManager._broadcast_presence(user_id, False)

    @staticmethod
    def disconnect(user_id: uuid.UUID, ws: WebSocket) -> None:
        pool = _connections.get(user_id)
        if pool is not None:
            pool.discard(ws)
            if not pool and _connections.get(user_id) is pool:
                _connections.pop(user_id, None)

    @staticmethod
    async def mark_online(user_id: uuid.UUID) -> None:
        """Refresh presence TTL (called on every WS activity)."""
        r = await _get_redis()
        await r.setex(f"presence:{user_id}", PRESENCE_KEY_TTL, "online")

    @staticmethod
    async def check_online(user_id: uuid.UUID) -> bool:
        """Check if user is online (connection in this process OR Redis key)."""
        if user_id in _connections:
            return True
        r = await _get_redis()
        val = await r.get(f"presence:{user_id}")
        return val is not None

    @staticmethod
    async def get_last_seen(user_id: uuid.UUID) -> str | None:
        """Get user's last seen timestamp."""
        r = await _get_redis()
        ts = await r.get(f"last_seen:{user_id}")
        if ts:
            return ts.decode() if isinstance(ts, bytes) else ts
        return None

    @staticmethod
    async def set_last_seen(user_id: uuid.UUID) -> None:
        r = await _get_redis()
        await r.setex(f"last_seen:{user_id}", 86400 * 7, datetime.now(UTC).isoformat())

    @staticmethod
    async def _presence_peers(user_id: uuid.UUID) -> set[uuid.UUID]:
        """Users who share a chat with `user_id` — the only ones entitled to
        see their online status (was: every connected user)."""
        from app.modules.exchanges.models import Chat, ExchangeRequest

        async with get_session_factory()() as session:
            rows = await session.execute(
                select(ExchangeRequest.requested_by, ExchangeRequest.requested_to)
                .join(Chat, Chat.exchange_request_id == ExchangeRequest.id)
                .where(
                    or_(
                        ExchangeRequest.requested_by == user_id,
                        ExchangeRequest.requested_to == user_id,
                    )
                )
            )
            peers = {uid for row in rows.all() for uid in row}
        peers.discard(user_id)
        return peers

    @staticmethod
    async def _broadcast_presence(user_id: uuid.UUID, is_online: bool) -> None:
        """Broadcast presence change to connected users who share a chat."""
        payload = {
            "type": "presence",
            "user_id": str(user_id),
            "is_online": is_online,
        }
        try:
            peers = await ConnectionManager._presence_peers(user_id)
        except Exception:
            logger.exception("Presence peer lookup failed for %s", user_id)
            return
        for uid in peers:
            if uid in _connections:
                await ConnectionManager.send_to_user(uid, payload)

    @staticmethod
    async def send_to_user(user_id: uuid.UUID, payload: dict[str, Any]) -> None:
        pool = _connections.get(user_id)
        if not pool:
            return
        text = json.dumps(payload, default=str)
        dead: list[WebSocket] = []
        # Snapshot: the set may change while we await a send.
        for ws in list(pool):
            try:
                await ws.send_text(text)
            except Exception:
                dead.append(ws)
        for ws in dead:
            pool.discard(ws)
        if not pool and _connections.get(user_id) is pool:
            _connections.pop(user_id, None)

    @staticmethod
    async def broadcast_to_chat(
        chat_id: uuid.UUID,
        payload: dict[str, Any],
        exclude_user_id: uuid.UUID | None = None,
        repo: ChatRepository | None = None,
    ) -> None:
        targets: set[uuid.UUID] = set()
        if repo:
            exchange = await repo.get_exchange_for_chat(chat_id)
            if exchange:
                targets = {exchange.requested_by, exchange.requested_to}
        # No repo → no way to know the participants → deliver to nobody.

        if exclude_user_id:
            targets.discard(exclude_user_id)

        for uid in targets:
            await ConnectionManager.send_to_user(uid, payload)


# ---------------------------------------------------------------------------
# Redis pub/sub
# ---------------------------------------------------------------------------

CHAT_CHANNEL_TPL = "chat:{chat_id}"


async def _get_redis() -> aioredis.Redis:
    global _redis_pubsub
    if _redis_pubsub is None:
        _redis_pubsub = aioredis.from_url(get_settings().redis_url)
    return _redis_pubsub


async def publish_message(chat_id: uuid.UUID, payload: dict[str, Any]) -> None:
    r = await _get_redis()
    channel = CHAT_CHANNEL_TPL.format(chat_id=chat_id)
    envelope = {"origin": _INSTANCE_ID, "payload": payload}
    await r.publish(channel, json.dumps(envelope, default=str))


async def subscribe_and_listen() -> None:
    while True:
        try:
            r = aioredis.from_url(get_settings().redis_url, socket_timeout=None)
            pubsub = r.pubsub()
            await pubsub.psubscribe("chat:*")
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Chat pub/sub connection failed, retrying in %ss", PUBSUB_RETRY_DELAY_SECONDS)
            await asyncio.sleep(PUBSUB_RETRY_DELAY_SECONDS)
            continue

        try:
            async for message in pubsub.listen():
                if message["type"] != "pmessage":
                    continue
                data = message["data"]
                if isinstance(data, bytes):
                    data = data.decode()
                channel = message["channel"]
                if isinstance(channel, bytes):
                    channel = channel.decode()

                try:
                    chat_id_str = channel.split(":", 1)[1]
                    chat_id = uuid.UUID(chat_id_str)
                except (IndexError, ValueError):
                    continue

                try:
                    envelope = json.loads(data)
                except json.JSONDecodeError:
                    continue
                if not isinstance(envelope, dict) or envelope.get("origin") == _INSTANCE_ID:
                    # Own echo — already delivered locally by the publisher.
                    continue
                payload = envelope.get("payload")
                if not isinstance(payload, dict):
                    continue

                sender_id = payload.get("sender_id")
                exclude: uuid.UUID | None = None
                if sender_id:
                    try:
                        exclude = uuid.UUID(sender_id)
                    except (ValueError, TypeError):
                        pass
                # Resolve the chat's two participants — NEVER fan out to every
                # connected socket (that leaked messages to all online users).
                async with get_session_factory()() as session:
                    await ConnectionManager.broadcast_to_chat(
                        chat_id, payload, exclude_user_id=exclude, repo=ChatRepository(session)
                    )
        except asyncio.CancelledError:
            await pubsub.punsubscribe("chat:*")
            await pubsub.close()
            await r.aclose()
            return
        except Exception:
            logger.exception("Chat pub/sub listener error, reconnecting in %ss", PUBSUB_RETRY_DELAY_SECONDS)
            await pubsub.close()
            await r.aclose()
            await asyncio.sleep(PUBSUB_RETRY_DELAY_SECONDS)
            continue


# ---------------------------------------------------------------------------
# Chat service
# ---------------------------------------------------------------------------


class ChatService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.repo = ChatRepository(session)

    # ── Ticket ───────────────────────────────────────────────────────────

    async def create_ticket(self, user_id: uuid.UUID) -> str:
        return await create_ticket(user_id)

    # ── Chat list ─────────────────────────────────────────────────────────

    async def list_chats(self, user_id: uuid.UUID) -> ChatListResponse:
        rows = await self.repo.list_chats_for_user(user_id)
        from app.modules.auth.repository import AuthRepository
        auth_repo = AuthRepository(self.session)

        items: list[ChatSummary] = []
        for row in rows:
            counterpart = await auth_repo.get_user_by_id(row["counterpart_id"])
            name = counterpart.name if counterpart else "Bilinmeyen"
            items.append(
                ChatSummary(
                    chat_id=row["chat_id"],
                    exchange_id=row["exchange_id"],
                    counterpart_id=row["counterpart_id"],
                    counterpart_name=name,
                    counterpart_avatar_url=counterpart.avatar_url if counterpart else None,
                    last_message=row["last_message"],
                    last_message_type=row.get("last_message_type", "text"),
                    last_message_at=row["last_message_at"],
                    unread_count=row["unread_count"],
                    is_pinned=row.get("is_pinned", False),
                    muted_until=row.get("muted_until"),
                )
            )

        return ChatListResponse(items=items)

    # ── Messages ──────────────────────────────────────────────────────────

    async def list_messages(
        self,
        exchange_id: uuid.UUID,
        user_id: uuid.UUID,
        cursor: str | None = None,
        limit: int = 50,
    ) -> MessageListResponse:
        chat = await self.repo.get_chat_by_exchange(exchange_id)
        if chat is None:
            raise ChatError("CHAT_NOT_FOUND", 404)
        if not await self.repo.is_participant(chat.id, user_id):
            raise ChatError("FORBIDDEN", 403)

        msgs = await self.repo.get_messages(chat.id, cursor, limit)
        has_more = len(msgs) > limit
        if has_more:
            msgs = msgs[:limit]

        next_cursor = None
        if has_more:
            from app.modules.books.repository import encode_ts_cursor
            last = msgs[-1]
            next_cursor = encode_ts_cursor(last.created_at, last.id)

        from app.modules.auth.repository import AuthRepository
        auth_repo = AuthRepository(self.session)

        reply_ids = [m.reply_to_id for m in msgs if m.reply_to_id]
        reply_map: dict[uuid.UUID, tuple[str, str]] = {}
        if reply_ids:
            for rid in reply_ids:
                reply_msg = await self.repo.get_message_by_id(rid)
                if reply_msg:
                    sender = await auth_repo.get_user_by_id(reply_msg.sender_id) if reply_msg.sender_id else None
                    sender_name = sender.name if sender else "Sistem"
                    reply_map[rid] = (reply_msg.text, sender_name)

        msg_ids = [m.id for m in msgs]
        reactions_map = await self.repo.get_reactions_for_messages(msg_ids)

        items = []
        for m in msgs:
            reply_text = None
            reply_sender_name = None
            if m.reply_to_id and m.reply_to_id in reply_map:
                reply_text, reply_sender_name = reply_map[m.reply_to_id]

            view = _to_view(m, reply_text, reply_sender_name)
            view.reactions = [
                ReactionView(emoji=r["emoji"], users=r["users"], count=r["count"])
                for r in reactions_map.get(m.id, [])
            ]
            items.append(view)

        return MessageListResponse(items=items, next_cursor=next_cursor)

    async def search_messages(
        self, exchange_id: uuid.UUID, user_id: uuid.UUID, query: str
    ) -> list[MessageView]:
        chat = await self.repo.get_chat_by_exchange(exchange_id)
        if chat is None:
            raise ChatError("CHAT_NOT_FOUND", 404)
        if not await self.repo.is_participant(chat.id, user_id):
            raise ChatError("FORBIDDEN", 403)

        msgs = await self.repo.search_messages(chat.id, query)
        return [_to_view(m) for m in msgs]

    async def get_pinned_messages(
        self, exchange_id: uuid.UUID, user_id: uuid.UUID
    ) -> list[MessageView]:
        chat = await self.repo.get_chat_by_exchange(exchange_id)
        if chat is None:
            raise ChatError("CHAT_NOT_FOUND", 404)
        if not await self.repo.is_participant(chat.id, user_id):
            raise ChatError("FORBIDDEN", 403)

        msgs = await self.repo.get_pinned_messages(chat.id)
        return [_to_view(m) for m in msgs]

    async def get_starred_messages(self, user_id: uuid.UUID) -> list[MessageView]:
        msgs = await self.repo.get_starred_messages(user_id)
        return [_to_view(m) for m in msgs]

    async def get_message_delivery_info(
        self, message_id: uuid.UUID, user_id: uuid.UUID
    ) -> MessageDeliveryInfo | None:
        info = await self.repo.get_message_delivery_info(message_id)
        if info is None:
            return None
        return MessageDeliveryInfo(**info)

    async def mark_read(
        self, exchange_id: uuid.UUID, user_id: uuid.UUID, up_to_message_id: uuid.UUID
    ) -> None:
        chat = await self.repo.get_chat_by_exchange(exchange_id)
        if chat is None:
            raise ChatError("CHAT_NOT_FOUND", 404)
        if not await self.repo.is_participant(chat.id, user_id):
            raise ChatError("FORBIDDEN", 403)

        marked_ids = await self.repo.mark_read(chat.id, user_id, up_to_message_id)
        if marked_ids:
            await self.session.commit()
            exchange = await self.repo.get_exchange_for_chat(chat.id)
            if exchange:
                other_id = (
                    exchange.requested_to if user_id == exchange.requested_by
                    else exchange.requested_by
                )
                await ConnectionManager.send_to_user(
                    other_id,
                    {
                        "type": "read",
                        "chat_id": str(chat.id),
                        "read_by": str(user_id),
                        "up_to_message_id": str(up_to_message_id),
                    },
                )

    # ── Chat settings ────────────────────────────────────────────────────

    async def get_chat_settings(
        self, exchange_id: uuid.UUID, user_id: uuid.UUID
    ) -> ChatSettingsView:
        chat = await self.repo.get_chat_by_exchange(exchange_id)
        if chat is None:
            raise ChatError("CHAT_NOT_FOUND", 404)

        settings = await self.repo.get_chat_settings(chat.id, user_id)
        if settings is None:
            return ChatSettingsView(
                is_muted=False, muted_until=None, font_size="normal", notification_sound="default"
            )

        # Effective mute: a temporary mute that has expired is treated as off.
        is_muted = settings.is_muted
        muted_until = settings.muted_until
        if is_muted and muted_until is not None and muted_until <= datetime.now(UTC):
            is_muted = False
            muted_until = None

        return ChatSettingsView(
            is_muted=is_muted,
            muted_until=muted_until,
            wallpaper_url=settings.wallpaper_url,
            font_size=settings.font_size or "normal",
            notification_sound=settings.notification_sound or "default",
        )

    async def update_chat_settings(
        self,
        exchange_id: uuid.UUID,
        user_id: uuid.UUID,
        is_muted: bool | None = None,
        wallpaper_url: str | None = None,
        font_size: str | None = None,
        notification_sound: str | None = None,
    ) -> ChatSettingsView:
        chat = await self.repo.get_chat_by_exchange(exchange_id)
        if chat is None:
            raise ChatError("CHAT_NOT_FOUND", 404)

        await self.repo.upsert_chat_settings(
            chat.id, user_id, is_muted, wallpaper_url, font_size, notification_sound
        )
        await self.session.commit()
        return await self.get_chat_settings(exchange_id, user_id)

    # ── Chat pin / mute / clear history ──────────────────────────────────

    async def pin_chat(self, exchange_id: uuid.UUID, user_id: uuid.UUID) -> bool:
        chat = await self.repo.get_chat_by_exchange(exchange_id)
        if chat is None:
            raise ChatError("CHAT_NOT_FOUND", 404)
        if not await self.repo.is_participant(chat.id, user_id):
            raise ChatError("FORBIDDEN", 403)
        await self.repo.set_chat_pinned(chat.id, user_id, True)
        await self.session.commit()
        return True

    async def unpin_chat(self, exchange_id: uuid.UUID, user_id: uuid.UUID) -> bool:
        chat = await self.repo.get_chat_by_exchange(exchange_id)
        if chat is None:
            raise ChatError("CHAT_NOT_FOUND", 404)
        if not await self.repo.is_participant(chat.id, user_id):
            raise ChatError("FORBIDDEN", 403)
        await self.repo.set_chat_pinned(chat.id, user_id, False)
        await self.session.commit()
        return False

    async def mute_chat(
        self, exchange_id: uuid.UUID, user_id: uuid.UUID, duration: str
    ) -> datetime | None:
        chat = await self.repo.get_chat_by_exchange(exchange_id)
        if chat is None:
            raise ChatError("CHAT_NOT_FOUND", 404)
        if not await self.repo.is_participant(chat.id, user_id):
            raise ChatError("FORBIDDEN", 403)

        if duration == "forever":
            muted_until: datetime | None = None
        else:
            delta = MUTE_DURATION_DELTAS.get(duration)
            if delta is None:
                raise ChatError("INVALID_DURATION", 400)
            muted_until = datetime.now(UTC) + delta

        await self.repo.set_chat_muted(chat.id, user_id, is_muted=True, muted_until=muted_until)
        await self.session.commit()
        return muted_until

    async def unmute_chat(self, exchange_id: uuid.UUID, user_id: uuid.UUID) -> None:
        chat = await self.repo.get_chat_by_exchange(exchange_id)
        if chat is None:
            raise ChatError("CHAT_NOT_FOUND", 404)
        if not await self.repo.is_participant(chat.id, user_id):
            raise ChatError("FORBIDDEN", 403)
        await self.repo.set_chat_muted(chat.id, user_id, is_muted=False, muted_until=None)
        await self.session.commit()

    async def clear_history(self, exchange_id: uuid.UUID, user_id: uuid.UUID) -> None:
        """Delete all messages in a chat. Both users see the chat as empty."""
        chat = await self.repo.get_chat_by_exchange(exchange_id)
        if chat is None:
            raise ChatError("CHAT_NOT_FOUND", 404)
        if not await self.repo.is_participant(chat.id, user_id):
            raise ChatError("FORBIDDEN", 403)
        await self.repo.clear_chat_history(chat.id)
        await self.session.commit()
        # Notify both participants in real-time so their message lists clear.
        payload = {"type": "cleared", "chat_id": str(chat.id)}
        await ConnectionManager.broadcast_to_chat(chat.id, payload, repo=self.repo)
        await publish_message(chat.id, payload)

    # ── Link previews ────────────────────────────────────────────────────

    async def extract_urls(self, text: str) -> list[str]:
        return await self.repo.extract_urls(text)

    # ── WebSocket handlers ───────────────────────────────────────────────

    async def handle_send(
        self,
        ws_user_id: uuid.UUID,
        ws: WebSocket,
        chat_id: uuid.UUID,
        text: str,
        reply_to_id: uuid.UUID | None = None,
        message_type: str = "text",
        extra: dict | None = None,
    ) -> None:
        if not await self.repo.is_participant(chat_id, ws_user_id):
            await self._ws_error(ws, "Not a participant of this chat")
            return

        exchange = await self.repo.get_exchange_for_chat(chat_id)
        if exchange is None:
            await self._ws_error(ws, "Chat not found")
            return

        other_id = (
            exchange.requested_to if ws_user_id == exchange.requested_by
            else exchange.requested_by
        )
        if await self.repo.is_blocked(ws_user_id, other_id):
            await self._ws_error(ws, "Cannot send message — user is blocked")
            return

        if len(text) > MESSAGE_LIMIT:
            await self._ws_error(ws, f"Message too long (max {MESSAGE_LIMIT} chars)")
            return

        if reply_to_id:
            reply_msg = await self.repo.get_message_by_id(reply_to_id)
            if reply_msg is None or reply_msg.chat_id != chat_id:
                reply_to_id = None

        msg = await self.repo.create_message(
            chat_id, ws_user_id, text, message_type, reply_to_id, extra
        )
        await self.session.commit()

        # Extract URLs for link preview
        from app.modules.auth.repository import AuthRepository
        auth_repo = AuthRepository(self.session)

        reply_text = None
        reply_sender_name = None
        if reply_to_id and reply_msg:
            sender = await auth_repo.get_user_by_id(reply_msg.sender_id)
            reply_text = reply_msg.text
            reply_sender_name = sender.name if sender else "Bilinmeyen"

        view = _to_view(msg, reply_text, reply_sender_name)
        sender_id_str = str(ws_user_id)
        payload = {
            "type": "message",
            "message": view.model_dump(mode="json"),
            "sender_id": sender_id_str,
        }

        await ConnectionManager.broadcast_to_chat(chat_id, payload, repo=self.repo)
        await publish_message(chat_id, payload)

        # ── Push + in-app notifications for offline members ──────────────
        try:
            notif_svc = NotificationService(self.session)
            sender_user = await auth_repo.get_user_by_id(ws_user_id)
            sender_name = sender_user.name if sender_user else ""
            member_ids = [exchange.requested_by, exchange.requested_to]
            for member_id in member_ids:
                if member_id == ws_user_id:
                    continue
                member_conns = _connections.get(member_id)
                is_online = member_conns is not None and len(member_conns) > 0
                await notif_svc.create_notification(
                    user_id=member_id,
                    type_="new_message",
                    payload={
                        "chat_id": str(chat_id),
                        "sender_id": str(ws_user_id),
                        "sender_name": sender_name,
                        "preview": text[:100] if text else "",
                    },
                )
                if not is_online:
                    try:
                        await send_push_to_user(
                            str(member_id),
                            PushMessage(
                                title="Yeni Mesaj",
                                body=text[:120] if text else "Yeni bir mesajınız var",
                                data={
                                    "type": "new_message",
                                    "chat_id": str(chat_id),
                                },
                            ),
                            session=self.session,
                        )
                    except Exception as exc:
                        logger.warning("Push send failed for user %s: %s", member_id, exc)
            await self.session.commit()
        except Exception:
            logger.exception("Failed to create push notifications for new message")

    async def handle_typing(
        self, ws_user_id: uuid.UUID, chat_id: uuid.UUID, is_typing: bool
    ) -> None:
        exchange = await self.repo.get_exchange_for_chat(chat_id)
        if exchange is None or ws_user_id not in (exchange.requested_by, exchange.requested_to):
            return

        other_id = (
            exchange.requested_to if ws_user_id == exchange.requested_by
            else exchange.requested_by
        )
        await ConnectionManager.send_to_user(
            other_id,
            {
                "type": "typing",
                "chat_id": str(chat_id),
                "user_id": str(ws_user_id),
                "is_typing": is_typing,
            },
        )

    async def handle_delete(
        self, ws_user_id: uuid.UUID, ws: WebSocket, chat_id: uuid.UUID, message_id: uuid.UUID
    ) -> None:
        if not await self.repo.is_participant(chat_id, ws_user_id):
            await self._ws_error(ws, "Not a participant of this chat")
            return

        target = await self.repo.get_message_by_id(message_id)
        if target is None or target.chat_id != chat_id:
            await self._ws_error(ws, "Cannot delete this message")
            return
        msg = await self.repo.delete_message(message_id, ws_user_id)
        if msg is None:
            await self._ws_error(ws, "Cannot delete this message")
            return

        await self.session.commit()

        payload = {
            "type": "deleted",
            "chat_id": str(chat_id),
            "message_id": str(message_id),
            "sender_id": str(ws_user_id),
        }
        await ConnectionManager.broadcast_to_chat(chat_id, payload, repo=self.repo)
        await publish_message(chat_id, payload)

    async def handle_reaction(
        self,
        ws_user_id: uuid.UUID,
        ws: WebSocket,
        chat_id: uuid.UUID,
        message_id: uuid.UUID,
        emoji: str,
        action: str,
    ) -> None:
        if not await self.repo.is_participant(chat_id, ws_user_id):
            await self._ws_error(ws, "Not a participant of this chat")
            return

        msg = await self.repo.get_message_by_id(message_id)
        if msg is None or msg.chat_id != chat_id:
            await self._ws_error(ws, "Message not found")
            return

        if action == "add":
            await self.repo.add_reaction(message_id, ws_user_id, emoji)
        elif action == "remove":
            await self.repo.remove_reaction(message_id, ws_user_id, emoji)
        else:
            await self._ws_error(ws, "Invalid reaction action")
            return

        await self.session.commit()

        reactions_map = await self.repo.get_reactions_for_messages([message_id])
        reactions = [
            {"emoji": r["emoji"], "users": r["users"], "count": r["count"]}
            for r in reactions_map.get(message_id, [])
        ]

        payload = {
            "type": "reaction",
            "chat_id": str(chat_id),
            "message_id": str(message_id),
            "reactions": reactions,
            "sender_id": str(ws_user_id),
        }
        await ConnectionManager.broadcast_to_chat(chat_id, payload, repo=self.repo)
        await publish_message(chat_id, payload)

    # ── WebRTC call signaling ────────────────────────────────────────────
    #
    # The chat WebSocket doubles as the signaling channel for 1:1 audio /
    # video calls. The server never touches SDP/ICE contents — it only
    # validates membership + block state and relays the event to the other
    # participant. Terminating events may carry a `log` object which is
    # persisted as a system message (call history in the thread).

    CALL_EVENTS = frozenset(
        {"offer", "answer", "ice", "end", "reject", "cancel", "busy"}
    )

    async def handle_call(
        self, ws_user_id: uuid.UUID, ws: WebSocket, raw: dict[str, Any]
    ) -> None:
        event = raw.get("event")
        chat_id_raw = raw.get("chat_id")
        call_id = str(raw.get("call_id") or "")
        if event not in self.CALL_EVENTS or not chat_id_raw or not call_id:
            await self._ws_error(ws, "Invalid call payload")
            return
        try:
            chat_id = uuid.UUID(str(chat_id_raw))
        except (ValueError, AttributeError):
            await self._ws_error(ws, "Invalid chat_id")
            return

        if not await self.repo.is_participant(chat_id, ws_user_id):
            await self._ws_error(ws, "Not a participant of this chat")
            return
        exchange = await self.repo.get_exchange_for_chat(chat_id)
        if exchange is None:
            await self._ws_error(ws, "Chat not found")
            return
        other_id = (
            exchange.requested_to if ws_user_id == exchange.requested_by
            else exchange.requested_by
        )
        if await self.repo.is_blocked(ws_user_id, other_id):
            await self._ws_error(ws, "Cannot call — user is blocked")
            return

        kind = raw.get("kind") if raw.get("kind") in ("audio", "video") else "audio"

        from app.modules.auth.repository import AuthRepository
        auth_repo = AuthRepository(self.session)
        caller = await auth_repo.get_user_by_id(ws_user_id)
        caller_name = caller.name if caller else ""

        relay = {
            "type": "call",
            "event": event,
            "chat_id": str(chat_id),
            "call_id": call_id,
            "kind": kind,
            "sender_id": str(ws_user_id),
            "sender_name": caller_name,
            "payload": raw.get("payload"),
        }
        await ConnectionManager.send_to_user(other_id, relay)

        if event == "offer":
            # Callee's WS is down (app backgrounded / Doze) → push an
            # incoming-call notification and hold a grace window: if the
            # callee opens the app (WS reconnects) before the caller's ring
            # timeout, re-deliver the buffered offer so the phone rings
            # in-app. Only if the window expires do we tell the caller
            # 'unavailable'.
            if not await ConnectionManager.check_online(other_id):
                try:
                    label = "görüntülü" if kind == "video" else "sesli"
                    await send_push_to_user(
                        str(other_id),
                        PushMessage(
                            title="📞 Gelen Arama",
                            body=f"{caller_name} seni arıyor ({label})",
                            data={
                                "type": "incoming_call",
                                "chat_id": str(chat_id),
                                "call_id": call_id,
                                "kind": kind,
                            },
                        ),
                        session=self.session,
                    )
                except Exception as exc:
                    logger.warning("Call push failed for user %s: %s", other_id, exc)

                async def _ring_grace_window() -> None:
                    # 12 × 2s ≈ 24s — inside the caller's 30s ring timeout.
                    for _ in range(12):
                        await asyncio.sleep(2)
                        if await ConnectionManager.check_online(other_id):
                            await ConnectionManager.send_to_user(other_id, relay)
                            return
                    try:
                        await ws.send_text(json.dumps({
                            "type": "call",
                            "event": "unavailable",
                            "chat_id": str(chat_id),
                            "call_id": call_id,
                            "kind": kind,
                        }))
                    except Exception:
                        pass  # caller's WS closed meanwhile — their own timer handles it

                task = asyncio.create_task(_ring_grace_window())
                # Keep a strong reference or the task may be GC'd mid-ring.
                _background_tasks.add(task)
                task.add_done_callback(_background_tasks.discard)

        # Persist a call-log system message when the terminating side asks
        # for it (exactly one side sends `log`, so no duplicates).
        log = raw.get("log")
        if event in ("end", "reject", "cancel") and isinstance(log, dict):
            status = log.get("status")
            if status not in ("ended", "missed", "rejected", "failed"):
                status = "ended"
            try:
                duration = max(0, int(log.get("duration_seconds") or 0))
            except (TypeError, ValueError):
                duration = 0
            text = "Görüntülü arama" if kind == "video" else "Sesli arama"
            msg = await self.repo.create_message(
                chat_id,
                ws_user_id,
                text,
                "system",
                None,
                {
                    "action": "call_log",
                    "kind": kind,
                    "status": status,
                    "duration_seconds": duration,
                    # Connection route telemetry: 'direct' (host/srflx P2P),
                    # 'relay' (TURN), or None for calls that never connected.
                    # Feeds the admin metrics P2P-vs-relay ratio.
                    "route": log.get("route") if log.get("route") in ("direct", "relay") else None,
                },
            )
            await self.session.commit()
            view = _to_view(msg, None, None)
            payload = {
                "type": "message",
                "message": view.model_dump(mode="json"),
                "sender_id": str(ws_user_id),
            }
            await ConnectionManager.broadcast_to_chat(chat_id, payload, repo=self.repo)
            await publish_message(chat_id, payload)

    async def handle_presence(self, ws_user_id: uuid.UUID) -> None:
        """Refresh presence and broadcast to peers."""
        await ConnectionManager.mark_online(ws_user_id)
        await ConnectionManager._broadcast_presence(ws_user_id, True)

    async def handle_ws_message(
        self, ws_user_id: uuid.UUID, ws: WebSocket, raw: dict[str, Any]
    ) -> None:
        msg_type = raw.get("type")

        # Refresh presence on any WS message
        await ConnectionManager.mark_online(ws_user_id)

        if msg_type == "ping":
            await ws.send_text(json.dumps({"type": "pong"}))

        elif msg_type == "send":
            chat_id_raw = raw.get("chat_id")
            text_raw = raw.get("text") or ""
            if not isinstance(text_raw, str):
                await self._ws_error(ws, "text must be a string")
                return
            text = text_raw.strip()
            message_type = raw.get("message_type") or "text"
            extra = raw.get("extra")
            problem = _validate_client_message(message_type, text, extra)
            if not chat_id_raw or problem:
                await self._ws_error(ws, problem or "chat_id is required")
                return
            try:
                chat_id = uuid.UUID(str(chat_id_raw))
            except (ValueError, AttributeError):
                await self._ws_error(ws, "Invalid chat_id")
                return
            reply_to_raw = raw.get("reply_to_id")
            reply_to_id = None
            if reply_to_raw:
                try:
                    reply_to_id = uuid.UUID(str(reply_to_raw))
                except (ValueError, AttributeError):
                    pass
            await self.handle_send(ws_user_id, ws, chat_id, text, reply_to_id, message_type, extra)

        elif msg_type == "typing":
            chat_id_raw = raw.get("chat_id")
            is_typing = raw.get("is_typing", False)
            if not chat_id_raw:
                return
            try:
                chat_id = uuid.UUID(str(chat_id_raw))
            except (ValueError, AttributeError):
                return
            await self.handle_typing(ws_user_id, chat_id, is_typing)

        elif msg_type == "delete":
            chat_id_raw = raw.get("chat_id")
            message_id_raw = raw.get("message_id")
            if not chat_id_raw or not message_id_raw:
                await self._ws_error(ws, "chat_id and message_id are required")
                return
            try:
                chat_id = uuid.UUID(str(chat_id_raw))
                message_id = uuid.UUID(str(message_id_raw))
            except (ValueError, AttributeError):
                await self._ws_error(ws, "Invalid IDs")
                return
            await self.handle_delete(ws_user_id, ws, chat_id, message_id)

        elif msg_type == "reaction":
            chat_id_raw = raw.get("chat_id")
            message_id_raw = raw.get("message_id")
            emoji = raw.get("emoji", "")
            action = raw.get("action", "add")
            if not chat_id_raw or not message_id_raw or not emoji:
                await self._ws_error(ws, "chat_id, message_id, and emoji are required")
                return
            try:
                chat_id = uuid.UUID(str(chat_id_raw))
                message_id = uuid.UUID(str(message_id_raw))
            except (ValueError, AttributeError):
                await self._ws_error(ws, "Invalid IDs")
                return
            await self.handle_reaction(ws_user_id, ws, chat_id, message_id, emoji, action)

        elif msg_type == "call":
            await self.handle_call(ws_user_id, ws, raw)

        elif msg_type == "presence":
            await self.handle_presence(ws_user_id)

        else:
            await self._ws_error(ws, f"Unknown message type: {msg_type}")

    @staticmethod
    async def _ws_error(ws: WebSocket, message: str) -> None:
        try:
            await ws.send_text(json.dumps({"type": "error", "error": message}))
        except Exception:
            pass


class ChatError(Exception):
    def __init__(self, code: str, status_code: int = 400) -> None:
        self.code = code
        self.status_code = status_code
