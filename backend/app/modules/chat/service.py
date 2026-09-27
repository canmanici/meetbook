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
from app.core.security import generate_opaque_token, hash_token
from app.core.ttl_cache import TTLCache
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
        if (
            not isinstance(extra, dict)
            or set(extra) != {"action"}
            or extra["action"] not in CLIENT_SYSTEM_ACTIONS
        ):
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
# Offers parked while the callee is offline (see handle_call grace window).
_pending_calls: dict[str, dict[str, Any]] = {}
# (chat_id, user_id) -> other participant, for call relays (60 s, bounded —
# was a dict that was never evicted).
_call_peer_cache: TTLCache[tuple[uuid.UUID, uuid.UUID], uuid.UUID] = TTLCache(
    maxsize=5000, ttl_seconds=60
)
# chat_id -> (requested_by, requested_to). A chat's participants never
# change, so the pub/sub listener and broadcast_to_chat can skip the DB
# round-trip (and session) for every relayed message.
_chat_participants: TTLCache[uuid.UUID, tuple[uuid.UUID, uuid.UUID]] = TTLCache(
    maxsize=20000, ttl_seconds=6 * 3600
)
# A socket that cannot take a frame within this long is treated as dead, so
# one stalled client no longer holds up delivery to everyone else.
WS_SEND_TIMEOUT_SECONDS = 5.0

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


async def _send_one(ws: WebSocket, text: str) -> bool:
    try:
        await asyncio.wait_for(ws.send_text(text), WS_SEND_TIMEOUT_SECONDS)
        return True
    except Exception:
        return False


def _close_quietly(ws: WebSocket) -> None:
    """A socket whose send failed/timed out may be half-written: close it so
    the client reconnects instead of silently missing events."""

    async def _close() -> None:
        try:
            await asyncio.wait_for(ws.close(code=1011), 1.0)
        except Exception:
            pass

    task = asyncio.create_task(_close())
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)


async def _send_all(sockets: list[WebSocket], text: str) -> list[WebSocket]:
    """Send one frame to several sockets concurrently; return the dead ones."""
    if not sockets:
        return []
    if len(sockets) == 1:
        ok = [await _send_one(sockets[0], text)]
    else:
        ok = await asyncio.gather(*(_send_one(ws, text) for ws in sockets))
    dead = [ws for ws, good in zip(sockets, ok, strict=True) if not good]
    for ws in dead:
        _close_quietly(ws)
    return dead


async def _fan_out(user_ids: Any, payload: dict[str, Any]) -> None:
    """Deliver to several users concurrently (was one await per user)."""
    targets = list(user_ids)
    if len(targets) == 1:
        await ConnectionManager.send_to_user(targets[0], payload)
    elif targets:
        await asyncio.gather(*(ConnectionManager.send_to_user(uid, payload) for uid in targets))


async def _get_chat_participants(
    chat_id: uuid.UUID, repo: "ChatRepository | None"
) -> tuple[uuid.UUID, uuid.UUID] | None:
    cached = _chat_participants.get(chat_id)
    if cached is not None:
        return cached
    if repo is None:
        return None
    exchange = await repo.get_exchange_for_chat(chat_id)
    if exchange is None:
        return None
    pair = (exchange.requested_by, exchange.requested_to)
    _chat_participants.set(chat_id, pair)
    return pair


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
        await _fan_out([uid for uid in peers if uid in _connections], payload)

    @staticmethod
    async def send_to_user(user_id: uuid.UUID, payload: dict[str, Any]) -> None:
        pool = _connections.get(user_id)
        if not pool:
            return
        text = json.dumps(payload, default=str)
        # Snapshot: the set may change while we await a send.
        dead = await _send_all(list(pool), text)
        for ws in dead:
            pool.discard(ws)
        if not pool and _connections.get(user_id) is pool:
            _connections.pop(user_id, None)

    @staticmethod
    async def send_to_user_except(
        user_id: uuid.UUID, exclude: WebSocket, payload: dict[str, Any]
    ) -> None:
        """Send to all of a user's local sockets except one (their other devices)."""
        pool = _connections.get(user_id)
        if not pool:
            return
        text = json.dumps(payload, default=str)
        for sock in await _send_all([s for s in pool if s is not exclude], text):
            pool.discard(sock)

    @staticmethod
    async def broadcast_to_chat(
        chat_id: uuid.UUID,
        payload: dict[str, Any],
        exclude_user_id: uuid.UUID | None = None,
        repo: ChatRepository | None = None,
    ) -> None:
        targets: set[uuid.UUID] = set()
        participants = await _get_chat_participants(chat_id, repo)
        if participants:
            targets = set(participants)
        # No repo and nothing cached → participants unknown → deliver to nobody.

        if exclude_user_id:
            targets.discard(exclude_user_id)

        await _fan_out(targets, payload)


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


CLUB_CHANNEL_TPL = "club:{club_id}"


async def publish_club_event(club_id: uuid.UUID, payload: dict[str, Any]) -> None:
    r = await _get_redis()
    envelope = {"origin": _INSTANCE_ID, "payload": payload}
    await r.publish(CLUB_CHANNEL_TPL.format(club_id=club_id), json.dumps(envelope, default=str))


async def _deliver_club_event(club_id: uuid.UUID, payload: dict[str, Any]) -> None:
    """Pub/sub from another instance → this instance's active club members."""
    from app.modules.clubs.models import ClubMember

    if not _connections:
        return  # nobody connected here — skip the DB round-trip

    async with get_session_factory()() as session:
        rows = await session.execute(
            select(ClubMember.user_id).where(
                ClubMember.club_id == club_id, ClubMember.status == "active"
            )
        )
        member_ids = [r[0] for r in rows.all()]
    await _fan_out([uid for uid in member_ids if uid in _connections], payload)


async def subscribe_and_listen() -> None:
    while True:
        try:
            r = aioredis.from_url(get_settings().redis_url, socket_timeout=None)
            pubsub = r.pubsub()
            await pubsub.psubscribe("chat:*", "club:*")
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception(
                "Chat pub/sub connection failed, retrying in %ss", PUBSUB_RETRY_DELAY_SECONDS
            )
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
                    kind, id_str = channel.split(":", 1)
                    chat_id = uuid.UUID(id_str)
                except IndexError, ValueError:
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
                if kind == "club":
                    await _deliver_club_event(chat_id, payload)
                    continue

                sender_id = payload.get("sender_id")
                exclude: uuid.UUID | None = None
                if sender_id:
                    try:
                        exclude = uuid.UUID(sender_id)
                    except ValueError, TypeError:
                        pass
                # Resolve the chat's two participants — NEVER fan out to every
                # connected socket (that leaked messages to all online users).
                if not _connections:
                    continue  # nobody connected to this instance
                if _chat_participants.get(chat_id) is not None:
                    # Cached: no DB session per relayed message.
                    await ConnectionManager.broadcast_to_chat(
                        chat_id, payload, exclude_user_id=exclude
                    )
                    continue
                async with get_session_factory()() as session:
                    await ConnectionManager.broadcast_to_chat(
                        chat_id, payload, exclude_user_id=exclude, repo=ChatRepository(session)
                    )
        except asyncio.CancelledError:
            await pubsub.punsubscribe("chat:*", "club:*")
            await pubsub.close()
            await r.aclose()
            return
        except Exception:
            logger.exception(
                "Chat pub/sub listener error, reconnecting in %ss", PUBSUB_RETRY_DELAY_SECONDS
            )
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

        users = await auth_repo.get_users_by_ids(row["counterpart_id"] for row in rows)
        items: list[ChatSummary] = []
        for row in rows:
            counterpart = users.get(row["counterpart_id"])
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

        reply_ids = {m.reply_to_id for m in msgs if m.reply_to_id}
        reply_map: dict[uuid.UUID, tuple[str, str]] = {}
        if reply_ids:
            # 2 queries per page (was 2 per quoted message).
            reply_msgs = await self.repo.get_messages_by_ids(reply_ids)
            senders = await auth_repo.get_users_by_ids(
                r.sender_id for r in reply_msgs if r.sender_id
            )
            for reply_msg in reply_msgs:
                sender = senders.get(reply_msg.sender_id) if reply_msg.sender_id else None
                sender_name = sender.name if sender else "Sistem"
                reply_map[reply_msg.id] = (reply_msg.text, sender_name)

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
                    exchange.requested_to
                    if user_id == exchange.requested_by
                    else exchange.requested_by
                )
                read_payload = {
                    "type": "read",
                    "chat_id": str(chat.id),
                    "sender_id": str(user_id),
                    "read_by": str(user_id),
                    "up_to_message_id": str(up_to_message_id),
                    # Exact ids + time so the sender flips ticks live.
                    "message_ids": [str(mid) for mid in marked_ids],
                    "read_at": datetime.now(UTC).isoformat(),
                }
                await ConnectionManager.send_to_user(other_id, read_payload)
                await publish_message(chat.id, read_payload)

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
        extra: dict[str, Any] | None = None,
        client_id: str | None = None,
    ) -> None:
        if not await self.repo.is_participant(chat_id, ws_user_id):
            await self._ws_error(ws, "Not a participant of this chat", client_id)
            return

        exchange = await self.repo.get_exchange_for_chat(chat_id)
        if exchange is None:
            await self._ws_error(ws, "Chat not found", client_id)
            return

        other_id = (
            exchange.requested_to if ws_user_id == exchange.requested_by else exchange.requested_by
        )
        if await self.repo.is_blocked(ws_user_id, other_id):
            await self._ws_error(ws, "Cannot send message — user is blocked", client_id)
            return

        if len(text) > MESSAGE_LIMIT:
            await self._ws_error(ws, f"Message too long (max {MESSAGE_LIMIT} chars)", client_id)
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
            sender = (
                await auth_repo.get_user_by_id(reply_msg.sender_id) if reply_msg.sender_id else None
            )
            reply_text = reply_msg.text
            reply_sender_name = sender.name if sender else "Bilinmeyen"

        view = _to_view(msg, reply_text, reply_sender_name)
        sender_id_str = str(ws_user_id)
        payload: dict[str, Any] = {
            "type": "message",
            "message": view.model_dump(mode="json"),
            "sender_id": sender_id_str,
        }
        # Echo the sender's optimistic-message id so the client reconciles
        # by identity instead of guessing by (trimmed) text.
        if client_id:
            payload["client_id"] = client_id

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
                # A muted chat must stay silent: no push, no bell entry.
                if await self._is_chat_muted(chat_id, member_id):
                    continue
                # Online members already see the message live (and the
                # unread badge) — only offline ones get a push. No bell
                # entry: the chats tab already tracks unread messages, and
                # one bell row per message buried everything else.
                # check_online covers sockets on other instances (Redis).
                if await ConnectionManager.check_online(member_id):
                    continue
                await notif_svc.notify(
                    member_id,
                    "new_message",
                    {
                        "chat_id": str(chat_id),
                        # The app routes chats by exchange id.
                        "exchange_id": str(exchange.id),
                        "sender_id": str(ws_user_id),
                    },
                    title=sender_name or "Yeni Mesaj",
                    body=text[:120] if text else "Yeni bir mesajınız var",
                    inbox=False,
                )
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
            exchange.requested_to if ws_user_id == exchange.requested_by else exchange.requested_by
        )
        payload = {
            "type": "typing",
            "chat_id": str(chat_id),
            "user_id": str(ws_user_id),
            "sender_id": str(ws_user_id),
            "is_typing": is_typing,
        }
        await ConnectionManager.send_to_user(other_id, payload)
        # sender_id lets other instances deliver to the peer only.
        await publish_message(chat_id, payload)

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
        {"offer", "answer", "ice", "end", "reject", "cancel", "busy", "ringing"}
    )
    # Events that end a call attempt (and may carry a call-log).
    TERMINAL_CALL_EVENTS = frozenset({"end", "reject", "cancel"})
    # Server-side record of a call (Redis, shared across instances): proves
    # a call really happened before a client-supplied log is persisted, and
    # bounds the logged duration by what the server actually observed.
    CALL_STATE_TTL_SECONDS = 6 * 3600

    async def _call_peer(
        self, ws_user_id: uuid.UUID, ws: WebSocket, chat_id: uuid.UUID, check_block: bool
    ) -> uuid.UUID | None:
        """Validate membership (+ block state) and return the other participant.

        Cached per (chat, user) for a minute: a call trickles dozens of ICE
        candidates and each used to cost 4 DB round-trips."""
        key = (chat_id, ws_user_id)
        cached = _call_peer_cache.get(key)
        if cached is not None and not check_block:
            return cached
        if not await self.repo.is_participant(chat_id, ws_user_id):
            await self._ws_error(ws, "Not a participant of this chat")
            return None
        exchange = await self.repo.get_exchange_for_chat(chat_id)
        if exchange is None:
            await self._ws_error(ws, "Chat not found")
            return None
        other_id = (
            exchange.requested_to if ws_user_id == exchange.requested_by else exchange.requested_by
        )
        if check_block and await self.repo.is_blocked(ws_user_id, other_id):
            await self._ws_error(ws, "Cannot call — user is blocked")
            return None
        _call_peer_cache.set(key, other_id)
        return other_id

    async def handle_call(self, ws_user_id: uuid.UUID, ws: WebSocket, raw: dict[str, Any]) -> None:
        event = raw.get("event")
        chat_id_raw = raw.get("chat_id")
        call_id = str(raw.get("call_id") or "")[:128]
        if event not in self.CALL_EVENTS or not chat_id_raw or not call_id:
            await self._ws_error(ws, "Invalid call payload")
            return
        try:
            chat_id = uuid.UUID(str(chat_id_raw))
        except ValueError, AttributeError:
            await self._ws_error(ws, "Invalid chat_id")
            return

        # Block state only matters when a call is being set up; the trickle
        # of ICE / terminal events can use the cached membership check.
        other_id = await self._call_peer(
            ws_user_id, ws, chat_id, check_block=event in ("offer", "answer")
        )
        if other_id is None:
            return

        kind = raw.get("kind") if raw.get("kind") in ("audio", "video") else "audio"

        caller_name = ""
        exchange_id: uuid.UUID | None = None
        if event == "offer":
            exchange = await self.repo.get_exchange_for_chat(chat_id)
            exchange_id = exchange.id if exchange is not None else None
            from app.modules.auth.repository import AuthRepository

            caller = await AuthRepository(self.session).get_user_by_id(ws_user_id)
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
        # Deliver to the peer's sockets on other instances too.
        await publish_message(chat_id, relay)

        r = await _get_redis()
        state_key = f"call:{call_id}"

        if event == "offer" and raw.get("payload") is not None:
            # First offer only (ICE-restart re-offers reuse the call id).
            await r.set(
                state_key,
                json.dumps(
                    {
                        "chat_id": str(chat_id),
                        "caller": str(ws_user_id),
                        "offered_at": datetime.now(UTC).timestamp(),
                        "answered_at": None,
                    }
                ),
                ex=self.CALL_STATE_TTL_SECONDS,
                nx=True,
            )
        elif event == "answer":
            raw_state = await r.get(state_key)
            if raw_state:
                state = json.loads(raw_state)
                if state.get("answered_at") is None:
                    state["answered_at"] = datetime.now(UTC).timestamp()
                    await r.set(state_key, json.dumps(state), ex=self.CALL_STATE_TTL_SECONDS)
            # The callee's OTHER devices are still ringing — stop them.
            await ConnectionManager.send_to_user_except(
                ws_user_id,
                ws,
                {**relay, "event": "cancel", "payload": None, "sender_id": str(other_id)},
            )
        elif event == "reject":
            await ConnectionManager.send_to_user_except(
                ws_user_id,
                ws,
                {**relay, "event": "cancel", "payload": None, "sender_id": str(other_id)},
            )

        # Callee offline: park ICE until the grace window re-delivers the
        # offer (they were silently dropped before → the re-delivered offer
        # had no remote candidates), and let a cancel stop the re-delivery.
        pending = _pending_calls.get(call_id)
        if pending is not None and pending["caller"] == ws_user_id:
            if event == "ice":
                pending["ice"].append(relay)
            elif event in self.TERMINAL_CALL_EVENTS:
                pending["cancelled"] = True

        if event == "offer" and raw.get("payload") is not None and call_id not in _pending_calls:
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
                                "exchange_id": str(exchange_id) if exchange_id else None,
                                "call_id": call_id,
                                "kind": kind,
                            },
                            channel_id="calls",
                        ),
                        session=self.session,
                    )
                except Exception as exc:
                    logger.warning("Call push failed for user %s: %s", other_id, exc)

                pending_entry: dict[str, Any] = {
                    "caller": ws_user_id,
                    "ice": [],
                    "cancelled": False,
                }
                _pending_calls[call_id] = pending_entry

                async def _ring_grace_window() -> None:
                    try:
                        # 12 × 2s ≈ 24s — inside the caller's 30s ring timeout.
                        for _ in range(12):
                            await asyncio.sleep(2)
                            if pending_entry["cancelled"]:
                                return  # caller hung up — never ring a dead call
                            if await ConnectionManager.check_online(other_id):
                                await ConnectionManager.send_to_user(other_id, relay)
                                await publish_message(chat_id, relay)
                                for ice in pending_entry["ice"]:
                                    await ConnectionManager.send_to_user(other_id, ice)
                                    await publish_message(chat_id, ice)
                                return
                        try:
                            await ws.send_text(
                                json.dumps(
                                    {
                                        "type": "call",
                                        "event": "unavailable",
                                        "chat_id": str(chat_id),
                                        "call_id": call_id,
                                        "kind": kind,
                                    }
                                )
                            )
                        except Exception:
                            pass  # caller's WS closed meanwhile — their own timer handles it
                    finally:
                        _pending_calls.pop(call_id, None)

                task = asyncio.create_task(_ring_grace_window())
                # Keep a strong reference or the task may be GC'd mid-ring.
                _background_tasks.add(task)
                task.add_done_callback(_background_tasks.discard)

        # Persist a call-log system message when the terminating side asks
        # for it — but only for a call the server actually saw start in this
        # chat, and only once per call (both sides timing out used to write
        # two logs). Duration is bounded by the server's own clock.
        log = raw.get("log")
        if event in self.TERMINAL_CALL_EVENTS and isinstance(log, dict):
            raw_state = await r.get(state_key)
            if not raw_state:
                return
            state = json.loads(raw_state)
            if state.get("chat_id") != str(chat_id):
                return
            if not await r.set(
                f"call:{call_id}:logged", "1", ex=self.CALL_STATE_TTL_SECONDS, nx=True
            ):
                return
            status = log.get("status")
            if status not in ("ended", "missed", "rejected", "failed"):
                status = "ended"
            answered_at = state.get("answered_at")
            if status == "ended" and answered_at is None:
                status = "missed"
            try:
                duration = max(0, int(log.get("duration_seconds") or 0))
            except TypeError, ValueError:
                duration = 0
            if answered_at is None:
                duration = 0
            else:
                observed = int(datetime.now(UTC).timestamp() - float(answered_at)) + 5
                duration = min(duration, max(0, observed))
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

            # A callee who never picked up is left with a stale "incoming
            # call" push — replace it with a missed-call entry they can act on.
            caller_id = state.get("caller")
            if status == "missed" and caller_id:
                await self._notify_missed_call(chat_id, uuid.UUID(caller_id), kind)

    async def _notify_missed_call(
        self, chat_id: uuid.UUID, caller_id: uuid.UUID, kind: str
    ) -> None:
        try:
            from app.modules.auth.repository import AuthRepository

            exchange = await self.repo.get_exchange_for_chat(chat_id)
            if exchange is None:
                return
            callee_id = (
                exchange.requested_to
                if caller_id == exchange.requested_by
                else exchange.requested_by
            )
            caller = await AuthRepository(self.session).get_user_by_id(caller_id)
            name = caller.name if caller and caller.name else "Takas ortağın"
            label = "görüntülü" if kind == "video" else "sesli"
            await NotificationService(self.session).notify(
                callee_id,
                "missed_call",
                {"chat_id": str(chat_id), "exchange_id": str(exchange.id), "kind": kind},
                title="Cevapsız arama",
                body=f"{name} seni {label} aradı",
                skip_push_if_online=True,
            )
            await self.session.commit()
        except Exception:
            logger.exception("Missed-call notification failed for chat %s", chat_id)

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
            client_id_raw = raw.get("client_id")
            client_id = (
                client_id_raw
                if isinstance(client_id_raw, str) and 0 < len(client_id_raw) <= 64
                else None
            )
            text_raw = raw.get("text") or ""
            if not isinstance(text_raw, str):
                await self._ws_error(ws, "text must be a string", client_id)
                return
            text = text_raw.strip()
            message_type = raw.get("message_type") or "text"
            extra = raw.get("extra")
            problem = _validate_client_message(message_type, text, extra)
            if not chat_id_raw or problem:
                await self._ws_error(ws, problem or "chat_id is required", client_id)
                return
            try:
                chat_id = uuid.UUID(str(chat_id_raw))
            except ValueError, AttributeError:
                await self._ws_error(ws, "Invalid chat_id", client_id)
                return
            reply_to_raw = raw.get("reply_to_id")
            reply_to_id = None
            if reply_to_raw:
                try:
                    reply_to_id = uuid.UUID(str(reply_to_raw))
                except ValueError, AttributeError:
                    pass
            await self.handle_send(
                ws_user_id, ws, chat_id, text, reply_to_id, message_type, extra, client_id
            )

        elif msg_type == "typing":
            chat_id_raw = raw.get("chat_id")
            is_typing = raw.get("is_typing", False)
            if not chat_id_raw:
                return
            try:
                chat_id = uuid.UUID(str(chat_id_raw))
            except ValueError, AttributeError:
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
            except ValueError, AttributeError:
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
            except ValueError, AttributeError:
                await self._ws_error(ws, "Invalid IDs")
                return
            await self.handle_reaction(ws_user_id, ws, chat_id, message_id, emoji, action)

        elif msg_type == "call":
            await self.handle_call(ws_user_id, ws, raw)

        elif msg_type == "presence":
            await self.handle_presence(ws_user_id)

        else:
            await self._ws_error(ws, f"Unknown message type: {msg_type}")

    async def _is_chat_muted(self, chat_id: uuid.UUID, user_id: uuid.UUID) -> bool:
        settings = await self.repo.get_chat_settings(chat_id, user_id)
        if settings is None or not settings.is_muted:
            return False
        until = settings.muted_until
        return until is None or until > datetime.now(UTC)

    @staticmethod
    async def _ws_error(ws: WebSocket, message: str, client_id: str | None = None) -> None:
        body: dict[str, Any] = {"type": "error", "error": message}
        if client_id:
            body["client_id"] = client_id
        try:
            await ws.send_text(json.dumps(body))
        except Exception:
            pass


class ChatError(Exception):
    def __init__(self, code: str, status_code: int = 400) -> None:
        self.code = code
        self.status_code = status_code
