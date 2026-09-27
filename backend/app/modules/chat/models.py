"""SQLAlchemy models for chat messages, media, settings, and system events."""

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Text,
    UniqueConstraint,
)
from sqlalchemy import text as sql_text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class Message(Base):
    """A single chat message, persisted to Postgres.

    Supports text, image, voice, location, book_card, and system message types.
    """

    __tablename__ = "messages"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid7)
    chat_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("chats.id", ondelete="CASCADE"),
        nullable=False,
    )
    sender_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id"),
        nullable=True,  # NULL for system messages
    )
    message_type: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        default="text",
    )  # text | image | voice | location | book_card | system
    text: Mapped[str] = mapped_column(Text, nullable=False, default="")
    reply_to_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("messages.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(UTC),
    )
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    deleted_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    starred_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    pinned_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Extra payload for non-text messages (JSON)
    # image: {"url": "...", "thumbnail_url": "...", "width": N, "height": N}
    # voice: {"url": "...", "duration_seconds": N}
    # location: {"lat": N, "lng": N, "name": "..."}
    # book_card: {"book_id": "...", "title": "...", "author": "...", "cover_url": "...", "category": "..."}
    # system: {"action": "exchange_accepted"|"exchange_completed"|"meetup_proposed"|..., "data": {...}}
    extra: Mapped[Any] = mapped_column(JSONB, nullable=True)

    __table_args__ = (
        CheckConstraint("char_length(text) <= 2000", name="ck_message_text_length"),
        # Latest message per chat + keyset message list (created_at DESC, id DESC).
        Index(
            "ix_messages_chat_created_id",
            "chat_id",
            sql_text("created_at DESC"),
            sql_text("id DESC"),
        ),
        # Unread badge counts only touch unread rows.
        Index(
            "ix_messages_chat_unread",
            "chat_id",
            postgresql_where=sql_text("read_at IS NULL AND deleted_at IS NULL"),
        ),
    )


class MessageReaction(Base):
    """Emoji reactions on messages — one per user per message per emoji."""

    __tablename__ = "message_reactions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid7)
    message_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("messages.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id"),
        nullable=False,
    )
    emoji: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(UTC),
    )

    __table_args__ = (
        UniqueConstraint("message_id", "user_id", "emoji", name="uq_reaction_per_user_emoji"),
    )


class ChatSettings(Base):
    """Per-user per-chat settings (mute, wallpaper, etc.)."""

    __tablename__ = "chat_settings"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid7)
    chat_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("chats.id", ondelete="CASCADE"),
        nullable=False,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id"),
        nullable=False,
    )
    is_muted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    muted_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    is_pinned: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    pinned_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    wallpaper_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    font_size: Mapped[str | None] = mapped_column(
        Text, nullable=True, default="normal"
    )  # small | normal | large
    notification_sound: Mapped[str | None] = mapped_column(Text, nullable=True, default="default")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(UTC),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
    )

    __table_args__ = (UniqueConstraint("chat_id", "user_id", name="uq_chat_settings_per_user"),)


class LinkPreview(Base):
    """Cached link previews for URLs shared in chat."""

    __tablename__ = "link_previews"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid7)
    url: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    title: Mapped[str | None] = mapped_column(Text, nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    image_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    site_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    fetched_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(UTC),
    )
