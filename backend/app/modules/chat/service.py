"""Chat business logic + WebSocket connection manager + Redis pub/sub."""

import asyncio
import json
import logging
import uuid
from datetime import UTC, datetime
from typing import Any

import redis.asyncio as aioredis
from fastapi import WebSocket
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.redis import get_redis
from app.core.security import hash_token, generate_opaque_token
from app.modules.chat.models import Message
from app.modules.chat.repository import ChatRepository
from app.modules.chat.schemas import (
    ChatListResponse,
    ChatSummary,
    MessageListResponse,
    MessageView,
    WSOutgoing,
)

TICKET_TTL_SECONDS = 30
MESSAGE_LIMIT = 2000
PUBSUB_RETRY_DELAY_SECONDS = 5

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# In-memory connection pool
#   user_id -> set[WebSocket]
# ---------------------------------------------------------------------------
_connections: dict[uuid.UUID, set[WebSocket]] = {}
_redis_pubsub: aioredis.Redis | None = None
_listener_task: Any = None  # asyncio.Task | None

# ── Standalone ticket helpers (used by WS endpoint without a DB session) ──


async def create_ticket(user_id: uuid.UUID) -> str:
    """Generate a single-use 30-second WebSocket ticket (standalone)."""
    raw = generate_opaque_token(16)
    hashed = hash_token(raw)
    r = await _get_redis()
    key = f"ws_ticket:{hashed}"
    await r.setex(key, TICKET_TTL_SECONDS, str(user_id))
    return raw


async def consume_ticket(ticket: str) -> uuid.UUID | None:
    """Validate and consume a single-use ticket. Returns user_id or None."""
    hashed = hash_token(ticket)
    r = await _get_redis()
    key = f"ws_ticket:{hashed}"
    raw_user_id = await r.get(key)
    if raw_user_id is None:
        return None
    await r.delete(key)  # single-use
    return uuid.UUID(raw_user_id.decode() if isinstance(raw_user_id, bytes) else raw_user_id)


def _to_view(msg: Message) -> MessageView:
    return MessageView(
        id=msg.id,
        chat_id=msg.chat_id,
        sender_id=msg.sender_id,
        text=msg.text,
        created_at=msg.created_at,
        read_at=msg.read_at,
    )


# ---------------------------------------------------------------------------
# Connection manager — wire-level WebSocket ops
# ---------------------------------------------------------------------------


class ConnectionManager:
    """Per-instance in-memory WebSocket pool."""

    @staticmethod
    async def connect(user_id: uuid.UUID, ws: WebSocket) -> None:
        await ws.accept()
        _connections.setdefault(user_id, set()).add(ws)

    @staticmethod
    def disconnect(user_id: uuid.UUID, ws: WebSocket) -> None:
        pool = _connections.get(user_id)
        if pool:
            pool.discard(ws)
            if not pool:
                _connections.pop(user_id, None)

    @staticmethod
    async def send_to_user(user_id: uuid.UUID, payload: dict[str, Any]) -> None:
        pool = _connections.get(user_id)
        if not pool:
            return
        text = json.dumps(payload, default=str)
        dead: list[WebSocket] = []
        for ws in pool:
            try:
                await ws.send_text(text)
            except Exception:
                dead.append(ws)
        for ws in dead:
            pool.discard(ws)
        if not pool:
            _connections.pop(user_id, None)

    @staticmethod
    async def broadcast_to_chat(
        chat_id: uuid.UUID,
        payload: dict[str, Any],
        exclude_user_id: uuid.UUID | None = None,
        repo: ChatRepository | None = None,
    ) -> None:
        """Deliver payload to every connected participant of *chat_id*.

        If *repo* is given the participant list is fetched from the DB;
        otherwise it falls back to the (less reliable) connection-pool keys.
        """
        targets: set[uuid.UUID] = set()
        if repo:
            exchange = await repo.get_exchange_for_chat(chat_id)
            if exchange:
                targets = {exchange.requested_by, exchange.requested_to}
        else:
            targets = set(_connections.keys())

        if exclude_user_id:
            targets.discard(exclude_user_id)

        for uid in targets:
            await ConnectionManager.send_to_user(uid, payload)


# ---------------------------------------------------------------------------
# Redis pub/sub helpers
# ---------------------------------------------------------------------------

CHAT_CHANNEL_TPL = "chat:{chat_id}"


async def _get_redis() -> aioredis.Redis:
    global _redis_pubsub
    if _redis_pubsub is None:
        _redis_pubsub = aioredis.from_url(get_settings().redis_url)
    return _redis_pubsub


async def publish_message(chat_id: uuid.UUID, payload: dict[str, Any]) -> None:
    """Publish a message event to Redis so other instances receive it."""
    r = await _get_redis()
    channel = CHAT_CHANNEL_TPL.format(chat_id=chat_id)
    await r.publish(channel, json.dumps(payload, default=str))


async def subscribe_and_listen() -> None:
    """Background coroutine: listen on ``chat:*`` Redis channels and
    deliver to local WebSocket connections.

    Launched once per process in the FastAPI lifespan. If the Redis
    connection fails or drops, retries with a fixed delay instead of
    dying silently for the lifetime of the process.

    Uses its own connection (socket_timeout=None) rather than the shared
    `_get_redis()` client — the default 5s socket timeout would otherwise
    abort `pubsub.listen()`'s indefinite blocking read every 5 seconds.
    """
    while True:
        try:
            r = aioredis.from_url(get_settings().redis_url, socket_timeout=None)
            pubsub = r.pubsub()
            await pubsub.psubscribe("chat:*")
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception(
                "Chat pub/sub connection failed, retrying in %ss",
                PUBSUB_RETRY_DELAY_SECONDS,
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

                # channel = "chat:<uuid>"
                try:
                    chat_id_str = channel.split(":", 1)[1]
                    chat_id = uuid.UUID(chat_id_str)
                except (IndexError, ValueError):
                    continue

                try:
                    payload = json.loads(data)
                except json.JSONDecodeError:
                    continue

                # Forward to local connections, excluding the original sender
                # (they already got the message from the fast-path local broadcast)
                sender_id = payload.get("sender_id")
                exclude: uuid.UUID | None = None
                if sender_id:
                    try:
                        exclude = uuid.UUID(sender_id)
                    except (ValueError, TypeError):
                        pass
                await ConnectionManager.broadcast_to_chat(chat_id, payload, exclude_user_id=exclude)
        except asyncio.CancelledError:
            await pubsub.punsubscribe("chat:*")
            await pubsub.close()
            await r.aclose()
            return
        except Exception:
            logger.exception(
                "Chat pub/sub listener error, reconnecting in %ss",
                PUBSUB_RETRY_DELAY_SECONDS,
            )
            await pubsub.close()
            await r.aclose()
            await asyncio.sleep(PUBSUB_RETRY_DELAY_SECONDS)
            continue


# ---------------------------------------------------------------------------
# Chat service (HTTP + WebSocket business logic)
# ---------------------------------------------------------------------------


class ChatService:
    """High-level chat operations used by both REST and WebSocket handlers."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.repo = ChatRepository(session)

    # ── Ticket auth ───────────────────────────────────────────────────────

    async def create_ticket(self, user_id: uuid.UUID) -> str:
        return await create_ticket(user_id)

    # ── Chat list ─────────────────────────────────────────────────────────

    async def list_chats(self, user_id: uuid.UUID) -> ChatListResponse:
        rows = await self.repo.list_chats_for_user(user_id)

        # Resolve counterpart names
        from app.modules.auth.repository import AuthRepository
        auth_repo = AuthRepository(self.session)

        items: list[ChatSummary] = []
        for row in rows:
            counterpart = await auth_repo.get_user_by_id(row["counterpart_id"])
            name = counterpart.name if counterpart else "Bilinmeyon"
            items.append(
                ChatSummary(
                    chat_id=row["chat_id"],
                    exchange_id=row["exchange_id"],
                    counterpart_id=row["counterpart_id"],
                    counterpart_name=name,
                    last_message=row["last_message"],
                    last_message_at=row["last_message_at"],
                    unread_count=row["unread_count"],
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
            from app.modules.books.repository import encode_cursor
            last = msgs[-1]
            next_cursor = encode_cursor(last.created_at, last.id)

        return MessageListResponse(
            items=[_to_view(m) for m in msgs],
            next_cursor=next_cursor,
        )

    async def mark_read(
        self,
        exchange_id: uuid.UUID,
        user_id: uuid.UUID,
        up_to_message_id: uuid.UUID,
    ) -> None:
        chat = await self.repo.get_chat_by_exchange(exchange_id)
        if chat is None:
            raise ChatError("CHAT_NOT_FOUND", 404)

        if not await self.repo.is_participant(chat.id, user_id):
            raise ChatError("FORBIDDEN", 403)

        marked_ids = await self.repo.mark_read(chat.id, user_id, up_to_message_id)
        if marked_ids:
            await self.session.commit()

            # Notify the other participant that messages were read
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

    # ── WebSocket message handling ────────────────────────────────────────

    async def handle_send(
        self,
        ws_user_id: uuid.UUID,
        ws: WebSocket,
        chat_id: uuid.UUID,
        text: str,
    ) -> None:
        """Validate, persist, publish, and deliver a chat message."""
        # Membership check
        if not await self.repo.is_participant(chat_id, ws_user_id):
            await self._ws_error(ws, "Not a participant of this chat")
            return

        # Block check (bidirectional)
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

        # Length check
        if len(text) > MESSAGE_LIMIT:
            await self._ws_error(ws, f"Message too long (max {MESSAGE_LIMIT} chars)")
            return

        # Persist
        msg = await self.repo.create_message(chat_id, ws_user_id, text)
        await self.session.commit()

        view = _to_view(msg)
        sender_id_str = str(ws_user_id)
        payload = {
            "type": "message",
            "message": view.model_dump(mode="json"),
            "sender_id": sender_id_str,  # used by Redis listener to skip sender
        }

        # 1. Deliver to local connections first (fast path, include sender)
        await ConnectionManager.broadcast_to_chat(
            chat_id, payload, repo=self.repo,
        )

        # 2. Publish to Redis so other instances get it
        await publish_message(chat_id, payload)

    async def handle_ws_message(
        self,
        ws_user_id: uuid.UUID,
        ws: WebSocket,
        raw: dict[str, Any],
    ) -> None:
        """Dispatch a raw WebSocket JSON message."""
        msg_type = raw.get("type")

        if msg_type == "ping":
            await ws.send_text(json.dumps({"type": "pong"}))

        elif msg_type == "send":
            chat_id_raw = raw.get("chat_id")
            text = raw.get("text", "").strip()
            if not chat_id_raw or not text:
                await self._ws_error(ws, "chat_id and text are required")
                return
            try:
                chat_id = uuid.UUID(str(chat_id_raw))
            except (ValueError, AttributeError):
                await self._ws_error(ws, "Invalid chat_id")
                return
            await self.handle_send(ws_user_id, ws, chat_id, text)

        else:
            await self._ws_error(ws, f"Unknown message type: {msg_type}")

    @staticmethod
    async def _ws_error(ws: WebSocket, message: str) -> None:
        try:
            await ws.send_text(
                json.dumps({"type": "error", "error": message})
            )
        except Exception:
            pass


class ChatError(Exception):
    def __init__(self, code: str, status_code: int = 400) -> None:
        self.code = code
        self.status_code = status_code
