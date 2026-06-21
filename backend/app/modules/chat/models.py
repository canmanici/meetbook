"""SQLAlchemy models for chat messages, media, settings, and system events."""

import uuid
from datetime import UTC, datetime

from sqlalchemy import (
    Column, DateTime, ForeignKey, Integer, Text, CheckConstraint,
    UniqueConstraint, Boolean, Float,
)
from sqlalchemy.dialects.postgresql import UUID, JSONB

from app.core.db import Base


class Message(Base):
    """A single chat message, persisted to Postgres.

    Supports text, image, voice, location, book_card, and system message types.
    """

    __tablename__ = "messages"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    chat_id = Column(
        UUID(as_uuid=True),
        ForeignKey("chats.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    sender_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id"),
        nullable=True,  # NULL for system messages
    )
    message_type = Column(
        Text,
        nullable=False,
        default="text",
    )  # text | image | voice | location | book_card | system
    text = Column(Text, nullable=False, default="")
    reply_to_id = Column(
        UUID(as_uuid=True),
        ForeignKey("messages.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(UTC),
        index=True,
    )
    read_at = Column(DateTime(timezone=True), nullable=True)
    deleted_at = Column(DateTime(timezone=True), nullable=True)
    deleted_by = Column(UUID(as_uuid=True), nullable=True)
    starred_at = Column(DateTime(timezone=True), nullable=True)
    pinned_at = Column(DateTime(timezone=True), nullable=True)

    # Extra payload for non-text messages (JSON)
    # image: {"url": "...", "thumbnail_url": "...", "width": N, "height": N}
    # voice: {"url": "...", "duration_seconds": N}
    # location: {"lat": N, "lng": N, "name": "..."}
    # book_card: {"book_id": "...", "title": "...", "author": "...", "cover_url": "...", "category": "..."}
    # system: {"action": "exchange_accepted"|"exchange_completed"|"meetup_proposed"|..., "data": {...}}
    extra = Column(JSONB, nullable=True)

    __table_args__ = (
        CheckConstraint("char_length(text) <= 2000", name="ck_message_text_length"),
    )


class MessageReaction(Base):
    """Emoji reactions on messages — one per user per message per emoji."""

    __tablename__ = "message_reactions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    message_id = Column(
        UUID(as_uuid=True),
        ForeignKey("messages.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id"),
        nullable=False,
    )
    emoji = Column(Text, nullable=False)
    created_at = Column(
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

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    chat_id = Column(
        UUID(as_uuid=True),
        ForeignKey("chats.id", ondelete="CASCADE"),
        nullable=False,
    )
    user_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id"),
        nullable=False,
    )
    is_muted = Column(Boolean, nullable=False, default=False)
    wallpaper_url = Column(Text, nullable=True)
    font_size = Column(Text, nullable=True, default="normal")  # small | normal | large
    notification_sound = Column(Text, nullable=True, default="default")
    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(UTC),
    )
    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
    )

    __table_args__ = (
        UniqueConstraint("chat_id", "user_id", name="uq_chat_settings_per_user"),
    )


class LinkPreview(Base):
    """Cached link previews for URLs shared in chat."""

    __tablename__ = "link_previews"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    url = Column(Text, nullable=False, unique=True)
    title = Column(Text, nullable=True)
    description = Column(Text, nullable=True)
    image_url = Column(Text, nullable=True)
    site_name = Column(Text, nullable=True)
    fetched_at = Column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(UTC),
    )
