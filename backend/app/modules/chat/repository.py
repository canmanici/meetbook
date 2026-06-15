"""Database queries for the chat module."""

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.chat.models import Message
from app.modules.exchanges.models import Block, Chat, ExchangeRequest


class ChatRepository:
    """Chat DB operations — single Chat per exchange, many Messages per Chat."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    # ── Chat lookup ──────────────────────────────────────────────────────

    async def get_chat_by_exchange(self, exchange_id: uuid.UUID) -> Chat | None:
        """Resolve Chat by exchange_request_id."""
        result = await self.session.execute(
            select(Chat).where(Chat.exchange_request_id == exchange_id)
        )
        return result.scalar_one_or_none()

    async def get_chat(self, chat_id: uuid.UUID) -> Chat | None:
        result = await self.session.execute(
            select(Chat).where(Chat.id == chat_id)
        )
        return result.scalar_one_or_none()

    async def get_exchange_for_chat(self, chat_id: uuid.UUID) -> ExchangeRequest | None:
        """Return the ExchangeRequest this chat belongs to."""
        result = await self.session.execute(
            select(ExchangeRequest)
            .join(Chat, Chat.exchange_request_id == ExchangeRequest.id)
            .where(Chat.id == chat_id)
        )
        return result.scalar_one_or_none()

    async def is_participant(self, chat_id: uuid.UUID, user_id: uuid.UUID) -> bool:
        """Check if user_id is a participant of the exchange this chat belongs to."""
        exchange = await self.get_exchange_for_chat(chat_id)
        if exchange is None:
            return False
        return user_id in (exchange.requested_by, exchange.requested_to)

    async def is_blocked(self, sender_id: uuid.UUID, receiver_id: uuid.UUID) -> bool:
        """Check if either user blocked the other."""
        result = await self.session.execute(
            select(func.count()).select_from(Block).where(
                or_(
                    and_(Block.blocker_id == sender_id, Block.blocked_id == receiver_id),
                    and_(Block.blocker_id == receiver_id, Block.blocked_id == sender_id),
                )
            )
        )
        return (result.scalar() or 0) > 0

    async def list_chats_for_user(
        self, user_id: uuid.UUID
    ) -> list[dict[str, Any]]:
        """Return all chats the user participates in, with last message & unread count."""
        # Subquery: last message per chat
        last_msg_sub = (
            select(
                Message.chat_id,
                func.max(Message.created_at).label("last_msg_at"),
            )
            .group_by(Message.chat_id)
            .subquery()
        )

        stmt = (
            select(
                Chat.id.label("chat_id"),
                ExchangeRequest.id.label("exchange_id"),
                ExchangeRequest.requested_by,
                ExchangeRequest.requested_to,
                last_msg_sub.c.last_msg_at,
            )
            .select_from(Chat)
            .join(
                ExchangeRequest,
                Chat.exchange_request_id == ExchangeRequest.id,
            )
            .outerjoin(
                last_msg_sub,
                last_msg_sub.c.chat_id == Chat.id,
            )
            .where(
                or_(
                    ExchangeRequest.requested_by == user_id,
                    ExchangeRequest.requested_to == user_id,
                )
            )
            .order_by(last_msg_sub.c.last_msg_at.desc().nullslast())
        )

        result = await self.session.execute(stmt)
        rows = result.all()

        chats = []
        for row in rows:
            counterpart_id = (
                row.requested_to if row.requested_by == user_id else row.requested_by
            )

            # Unread count
            unread = await self._count_unread(row.chat_id, user_id)

            # Last message text
            last_text = None
            if row.last_msg_at is not None:
                msg_result = await self.session.execute(
                    select(Message.text)
                    .where(
                        Message.chat_id == row.chat_id,
                        Message.deleted_at.is_(None),
                    )
                    .order_by(Message.created_at.desc())
                    .limit(1)
                )
                last_text = msg_result.scalar_one_or_none()

            chats.append({
                "chat_id": row.chat_id,
                "exchange_id": row.exchange_id,
                "counterpart_id": counterpart_id,
                "last_message": last_text,
                "last_message_at": row.last_msg_at,
                "unread_count": unread,
            })

        return chats

    async def _count_unread(self, chat_id: uuid.UUID, user_id: uuid.UUID) -> int:
        """Count messages the user hasn't read in this chat (sent by others)."""
        result = await self.session.execute(
            select(func.count()).select_from(Message).where(
                Message.chat_id == chat_id,
                Message.sender_id != user_id,
                Message.read_at.is_(None),
                Message.deleted_at.is_(None),
            )
        )
        return result.scalar() or 0

    # ── Messages ─────────────────────────────────────────────────────────

    async def create_message(
        self, chat_id: uuid.UUID, sender_id: uuid.UUID, text: str
    ) -> Message:
        msg = Message(chat_id=chat_id, sender_id=sender_id, text=text)
        self.session.add(msg)
        await self.session.flush()
        return msg

    async def get_messages(
        self,
        chat_id: uuid.UUID,
        cursor: str | None = None,
        limit: int = 50,
    ) -> list[Message]:
        stmt = (
            select(Message)
            .where(
                Message.chat_id == chat_id,
                Message.deleted_at.is_(None),
            )
            .order_by(Message.created_at.desc(), Message.id.desc())
            .limit(limit + 1)
        )

        if cursor:
            from app.modules.books.repository import decode_cursor
            cursor_created_at, cursor_id = decode_cursor(cursor)
            stmt = stmt.where(
                or_(
                    Message.created_at < cursor_created_at,
                    and_(
                        Message.created_at == cursor_created_at,
                        Message.id < cursor_id,
                    ),
                )
            )

        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def mark_read(
        self, chat_id: uuid.UUID, user_id: uuid.UUID, up_to_message_id: uuid.UUID
    ) -> list[uuid.UUID]:
        """Mark all unread messages up to (and including) up_to_message_id as read.

        Returns the list of message IDs that were marked.
        """
        target = await self.session.execute(
            select(Message).where(
                Message.id == up_to_message_id,
                Message.chat_id == chat_id,
                Message.deleted_at.is_(None),
            )
        )
        target_msg = target.scalar_one_or_none()
        if target_msg is None:
            return []

        # Mark all unread messages created on or before the target
        result = await self.session.execute(
            select(Message).where(
                Message.chat_id == chat_id,
                Message.sender_id != user_id,
                Message.read_at.is_(None),
                Message.deleted_at.is_(None),
                Message.created_at <= target_msg.created_at,
            )
        )
        msgs = list(result.scalars().all())
        now = datetime.now(UTC)
        ids: list[uuid.UUID] = []
        for m in msgs:
            m.read_at = now
            ids.append(m.id)
        return ids
