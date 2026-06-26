"""Database queries for the chat module — messages, reactions, settings, media, presence."""

import re
import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.chat.models import (
    ChatSettings,
    LinkPreview,
    Message,
    MessageReaction,
)
from app.modules.exchanges.models import Block, Chat, ExchangeRequest

# ---------------------------------------------------------------------------
# URL detection for link previews
# ---------------------------------------------------------------------------
URL_PATTERN = re.compile(r'https?://[^\s]+')

# ---------------------------------------------------------------------------
# Repository
# ---------------------------------------------------------------------------


class ChatRepository:
    """Chat DB operations — single Chat per exchange, many Messages per Chat."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    # ── Chat lookup ──────────────────────────────────────────────────────

    async def get_chat_by_exchange(self, exchange_id: uuid.UUID) -> Chat | None:
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
        result = await self.session.execute(
            select(ExchangeRequest)
            .join(Chat, Chat.exchange_request_id == ExchangeRequest.id)
            .where(Chat.id == chat_id)
        )
        return result.scalar_one_or_none()

    async def is_participant(self, chat_id: uuid.UUID, user_id: uuid.UUID) -> bool:
        exchange = await self.get_exchange_for_chat(chat_id)
        if exchange is None:
            return False
        return user_id in (exchange.requested_by, exchange.requested_to)

    async def is_blocked(self, sender_id: uuid.UUID, receiver_id: uuid.UUID) -> bool:
        result = await self.session.execute(
            select(func.count()).select_from(Block).where(
                or_(
                    and_(Block.blocker_id == sender_id, Block.blocked_id == receiver_id),
                    and_(Block.blocker_id == receiver_id, Block.blocked_id == sender_id),
                )
            )
        )
        return (result.scalar() or 0) > 0

    # ── Chat list ─────────────────────────────────────────────────────────

    async def list_chats_for_user(self, user_id: uuid.UUID) -> list[dict[str, Any]]:
        last_msg_sub = (
            select(
                Message.chat_id,
                func.max(Message.created_at).label("last_msg_at"),
            )
            .group_by(Message.chat_id)
            .subquery()
        )

        unread_subq = (
            select(func.count())
            .where(
                Message.chat_id == Chat.id,
                Message.sender_id != user_id,
                Message.read_at.is_(None),
                Message.deleted_at.is_(None),
            )
            .correlate(Chat)
            .scalar_subquery()
        )

        last_text_subq = (
            select(Message.text)
            .where(
                Message.chat_id == Chat.id,
                Message.deleted_at.is_(None),
            )
            .order_by(Message.created_at.desc())
            .limit(1)
            .correlate(Chat)
            .scalar_subquery()
        )

        last_type_subq = (
            select(Message.message_type)
            .where(
                Message.chat_id == Chat.id,
                Message.deleted_at.is_(None),
            )
            .order_by(Message.created_at.desc())
            .limit(1)
            .correlate(Chat)
            .scalar_subquery()
        )

        stmt = (
            select(
                Chat.id.label("chat_id"),
                ExchangeRequest.id.label("exchange_id"),
                ExchangeRequest.requested_by,
                ExchangeRequest.requested_to,
                unread_subq.label("unread_count"),
                last_text_subq.label("last_message_text"),
                last_type_subq.label("last_message_type"),
                last_msg_sub.c.last_msg_at,
            )
            .select_from(Chat)
            .join(ExchangeRequest, Chat.exchange_request_id == ExchangeRequest.id)
            .outerjoin(last_msg_sub, last_msg_sub.c.chat_id == Chat.id)
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
            chats.append({
                "chat_id": row.chat_id,
                "exchange_id": row.exchange_id,
                "counterpart_id": counterpart_id,
                "last_message": row.last_message_text,
                "last_message_type": row.last_message_type or "text",
                "last_message_at": row.last_msg_at,
                "unread_count": row.unread_count or 0,
            })

        return chats

    async def _count_unread(self, chat_id: uuid.UUID, user_id: uuid.UUID) -> int:
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
        self,
        chat_id: uuid.UUID,
        sender_id: uuid.UUID | None,
        text: str,
        message_type: str = "text",
        reply_to_id: uuid.UUID | None = None,
        extra: dict | None = None,
    ) -> Message:
        msg = Message(
            chat_id=chat_id,
            sender_id=sender_id,
            text=text,
            message_type=message_type,
            reply_to_id=reply_to_id,
            extra=extra,
        )
        self.session.add(msg)
        await self.session.flush()
        return msg

    async def get_message_by_id(self, message_id: uuid.UUID) -> Message | None:
        result = await self.session.execute(
            select(Message).where(Message.id == message_id)
        )
        return result.scalar_one_or_none()

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

    async def get_pinned_messages(self, chat_id: uuid.UUID) -> list[Message]:
        """Get all pinned messages in a chat."""
        result = await self.session.execute(
            select(Message)
            .where(
                Message.chat_id == chat_id,
                Message.pinned_at.isnot(None),
                Message.deleted_at.is_(None),
            )
            .order_by(Message.pinned_at.desc())
        )
        return list(result.scalars().all())

    async def get_starred_messages(self, user_id: uuid.UUID) -> list[Message]:
        """Get all starred messages across all chats for a user."""
        result = await self.session.execute(
            select(Message)
            .join(Chat, Message.chat_id == Chat.id)
            .join(ExchangeRequest, Chat.exchange_request_id == ExchangeRequest.id)
            .where(
                or_(
                    ExchangeRequest.requested_by == user_id,
                    ExchangeRequest.requested_to == user_id,
                ),
                Message.starred_at.isnot(None),
                Message.deleted_at.is_(None),
            )
            .order_by(Message.starred_at.desc())
        )
        return list(result.scalars().all())

    async def toggle_star(self, message_id: uuid.UUID) -> bool:
        """Toggle star on a message. Returns new starred state."""
        msg = await self.get_message_by_id(message_id)
        if msg is None:
            return False
        if msg.starred_at:
            msg.starred_at = None
        else:
            msg.starred_at = datetime.now(UTC)
        await self.session.flush()
        return msg.starred_at is not None

    async def toggle_pin(self, message_id: uuid.UUID) -> bool:
        """Toggle pin on a message. Returns new pinned state."""
        msg = await self.get_message_by_id(message_id)
        if msg is None:
            return False
        if msg.pinned_at:
            msg.pinned_at = None
        else:
            msg.pinned_at = datetime.now(UTC)
        await self.session.flush()
        return msg.pinned_at is not None

    async def delete_message(
        self, message_id: uuid.UUID, user_id: uuid.UUID
    ) -> Message | None:
        """Soft-delete a message (for everyone). Only sender can delete."""
        msg = await self.get_message_by_id(message_id)
        if msg is None or msg.sender_id != user_id:
            return None
        msg.deleted_at = datetime.now(UTC)
        msg.deleted_by = user_id
        msg.text = ""
        await self.session.flush()
        return msg

    async def search_messages(
        self,
        chat_id: uuid.UUID,
        query: str,
        limit: int = 50,
    ) -> list[Message]:
        stmt = (
            select(Message)
            .where(
                Message.chat_id == chat_id,
                Message.deleted_at.is_(None),
                Message.text.ilike(f"%{query}%"),
            )
            .order_by(Message.created_at.desc())
            .limit(limit)
        )
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def mark_read(
        self, chat_id: uuid.UUID, user_id: uuid.UUID, up_to_message_id: uuid.UUID
    ) -> list[uuid.UUID]:
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

    async def get_message_delivery_info(
        self, message_id: uuid.UUID
    ) -> dict[str, Any] | None:
        """Get detailed delivery info for a message: sent_at, delivered_to, read_by."""
        msg = await self.get_message_by_id(message_id)
        if msg is None:
            return None

        exchange = await self.get_exchange_for_chat(msg.chat_id)
        if exchange is None:
            return None

        other_id = (
            exchange.requested_to if msg.sender_id == exchange.requested_by
            else exchange.requested_by
        )

        return {
            "message_id": str(msg.id),
            "sent_at": msg.created_at.isoformat(),
            "read_at": msg.read_at.isoformat() if msg.read_at else None,
            "delivered_to": str(other_id),
        }

    # ── Reactions ────────────────────────────────────────────────────────

    async def add_reaction(
        self, message_id: uuid.UUID, user_id: uuid.UUID, emoji: str
    ) -> MessageReaction:
        reaction = MessageReaction(
            message_id=message_id,
            user_id=user_id,
            emoji=emoji,
        )
        self.session.add(reaction)
        await self.session.flush()
        return reaction

    async def remove_reaction(
        self, message_id: uuid.UUID, user_id: uuid.UUID, emoji: str
    ) -> bool:
        result = await self.session.execute(
            select(MessageReaction).where(
                MessageReaction.message_id == message_id,
                MessageReaction.user_id == user_id,
                MessageReaction.emoji == emoji,
            )
        )
        reaction = result.scalar_one_or_none()
        if reaction is None:
            return False
        await self.session.delete(reaction)
        await self.session.flush()
        return True

    async def get_reactions_for_messages(
        self, message_ids: list[uuid.UUID]
    ) -> dict[uuid.UUID, list[dict[str, Any]]]:
        if not message_ids:
            return {}

        result = await self.session.execute(
            select(MessageReaction).where(MessageReaction.message_id.in_(message_ids))
        )
        reactions = list(result.scalars().all())

        grouped: dict[uuid.UUID, dict[str, list[uuid.UUID]]] = {}
        for r in reactions:
            if r.message_id not in grouped:
                grouped[r.message_id] = {}
            if r.emoji not in grouped[r.message_id]:
                grouped[r.message_id][r.emoji] = []
            grouped[r.message_id][r.emoji].append(r.user_id)

        output: dict[uuid.UUID, list[dict[str, Any]]] = {}
        for msg_id, emojis in grouped.items():
            output[msg_id] = [
                {"emoji": emoji, "users": users, "count": len(users)}
                for emoji, users in emojis.items()
            ]
        return output

    # ── Chat settings ────────────────────────────────────────────────────

    async def get_chat_settings(
        self, chat_id: uuid.UUID, user_id: uuid.UUID
    ) -> ChatSettings | None:
        result = await self.session.execute(
            select(ChatSettings).where(
                ChatSettings.chat_id == chat_id,
                ChatSettings.user_id == user_id,
            )
        )
        return result.scalar_one_or_none()

    async def upsert_chat_settings(
        self,
        chat_id: uuid.UUID,
        user_id: uuid.UUID,
        is_muted: bool | None = None,
        wallpaper_url: str | None = None,
        font_size: str | None = None,
        notification_sound: str | None = None,
    ) -> ChatSettings:
        settings = await self.get_chat_settings(chat_id, user_id)
        if settings is None:
            settings = ChatSettings(chat_id=chat_id, user_id=user_id)
            self.session.add(settings)

        if is_muted is not None:
            settings.is_muted = is_muted
        if wallpaper_url is not None:
            settings.wallpaper_url = wallpaper_url
        if font_size is not None:
            settings.font_size = font_size
        if notification_sound is not None:
            settings.notification_sound = notification_sound
        settings.updated_at = datetime.now(UTC)

        await self.session.flush()
        return settings

    # ── Link previews ────────────────────────────────────────────────────

    async def get_link_preview(self, url: str) -> LinkPreview | None:
        result = await self.session.execute(
            select(LinkPreview).where(LinkPreview.url == url)
        )
        return result.scalar_one_or_none()

    async def create_link_preview(
        self,
        url: str,
        title: str | None = None,
        description: str | None = None,
        image_url: str | None = None,
        site_name: str | None = None,
    ) -> LinkPreview:
        preview = LinkPreview(
            url=url,
            title=title,
            description=description,
            image_url=image_url,
            site_name=site_name,
        )
        self.session.add(preview)
        await self.session.flush()
        return preview

    async def extract_urls(self, text: str) -> list[str]:
        """Extract unique URLs from message text."""
        return list(set(URL_PATTERN.findall(text)))
