"""Pydantic schemas for the chat module — messages, reactions, settings, presence."""

import uuid
from datetime import datetime

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Request schemas
# ---------------------------------------------------------------------------


class ChatTicketResponse(BaseModel):
    ticket: str
    expires_in_seconds: int = 30


class MessageSendRequest(BaseModel):
    chat_id: uuid.UUID
    text: str = Field(min_length=1, max_length=2000)
    reply_to_id: uuid.UUID | None = None
    message_type: str = "text"  # text | image | voice | location | book_card
    extra: dict | None = None


class ChatMarkReadRequest(BaseModel):
    up_to_message_id: uuid.UUID


class ReactionRequest(BaseModel):
    emoji: str = Field(min_length=1, max_length=8)


class ChatSettingsRequest(BaseModel):
    is_muted: bool | None = None
    wallpaper_url: str | None = None
    font_size: str | None = None  # small | normal | large
    notification_sound: str | None = None


# ---------------------------------------------------------------------------
# Response schemas
# ---------------------------------------------------------------------------


class ReactionView(BaseModel):
    emoji: str
    users: list[uuid.UUID]
    count: int


class MessageDeliveryInfo(BaseModel):
    message_id: str
    sent_at: str
    read_at: str | None = None
    delivered_to: str


class MessageView(BaseModel):
    id: uuid.UUID
    chat_id: uuid.UUID
    sender_id: uuid.UUID | None = None  # NULL for system messages
    message_type: str = "text"
    text: str
    created_at: datetime
    read_at: datetime | None = None
    reply_to_id: uuid.UUID | None = None
    reply_to_text: str | None = None
    reply_to_sender_name: str | None = None
    reactions: list[ReactionView] = []
    starred_at: datetime | None = None
    pinned_at: datetime | None = None
    extra: dict | None = None  # image/voice/location/book_card/system payload


class MessageListResponse(BaseModel):
    items: list[MessageView]
    next_cursor: str | None = None


class MessageSearchResult(BaseModel):
    message: MessageView
    context_before: str | None = None
    context_after: str | None = None


class MessageSearchResponse(BaseModel):
    items: list[MessageSearchResult]
    total: int


class ChatSettingsView(BaseModel):
    is_muted: bool
    wallpaper_url: str | None = None
    font_size: str
    notification_sound: str


class ChatSettingsResponse(BaseModel):
    settings: ChatSettingsView


class PinnedMessagesResponse(BaseModel):
    items: list[MessageView]


class StarredMessagesResponse(BaseModel):
    items: list[MessageView]


class ChatSummary(BaseModel):
    chat_id: uuid.UUID
    exchange_id: uuid.UUID
    counterpart_id: uuid.UUID
    counterpart_name: str
    last_message: str | None = None
    last_message_type: str = "text"
    last_message_at: datetime | None = None
    unread_count: int = 0


class ChatListResponse(BaseModel):
    items: list[ChatSummary]


# ---------------------------------------------------------------------------
# Presence
# ---------------------------------------------------------------------------


class PresenceView(BaseModel):
    user_id: str
    is_online: bool
    last_seen: str | None = None


# ---------------------------------------------------------------------------
# WebSocket message types
# ---------------------------------------------------------------------------


class WSIncoming(BaseModel):
    type: str  # "send" | "typing" | "ping" | "presence"
    chat_id: uuid.UUID | None = None
    text: str | None = None
    reply_to_id: uuid.UUID | None = None
    message_type: str = "text"
    extra: dict | None = None


class WSOutgoing(BaseModel):
    type: str  # "message" | "read" | "typing" | "reaction" | "deleted" | "presence" | "error" | "pong"
    message: MessageView | None = None
    error: str | None = None
