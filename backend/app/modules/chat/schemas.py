"""Pydantic schemas for the chat module."""

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
    """Sent by the client over WebSocket."""

    chat_id: uuid.UUID
    text: str = Field(min_length=1, max_length=2000)


class ChatMarkReadRequest(BaseModel):
    up_to_message_id: uuid.UUID


# ---------------------------------------------------------------------------
# Response schemas
# ---------------------------------------------------------------------------


class MessageView(BaseModel):
    id: uuid.UUID
    chat_id: uuid.UUID
    sender_id: uuid.UUID
    text: str
    created_at: datetime
    read_at: datetime | None = None


class MessageListResponse(BaseModel):
    items: list[MessageView]
    next_cursor: str | None = None


class ChatSummary(BaseModel):
    """Minimal chat view for the chat list screen."""

    chat_id: uuid.UUID
    exchange_id: uuid.UUID
    counterpart_id: uuid.UUID
    counterpart_name: str
    last_message: str | None = None
    last_message_at: datetime | None = None
    unread_count: int = 0


class ChatListResponse(BaseModel):
    items: list[ChatSummary]


# ---------------------------------------------------------------------------
# WebSocket message types
# ---------------------------------------------------------------------------


class WSIncoming(BaseModel):
    """Message the client sends over WebSocket."""

    type: str  # "send" | "ping"
    chat_id: uuid.UUID | None = None
    text: str | None = None


class WSOutgoing(BaseModel):
    """Message the server sends over WebSocket."""

    type: str  # "message" | "read" | "error" | "pong"
    message: MessageView | None = None
    error: str | None = None
