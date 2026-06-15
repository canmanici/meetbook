"""Chat REST + WebSocket endpoints."""

import json
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_session, get_session_factory
from app.modules.auth.dependencies import get_current_user
from app.modules.auth.models import User
from app.modules.chat.schemas import (
    ChatListResponse,
    ChatMarkReadRequest,
    ChatTicketResponse,
    MessageListResponse,
)
from app.modules.chat.service import (
    ChatError,
    ChatService,
    ConnectionManager,
    consume_ticket,
)

# ---------------------------------------------------------------------------
# REST router — exchange-scoped chat endpoints
# ---------------------------------------------------------------------------

router = APIRouter(prefix="/exchanges", tags=["chat"])


def _get_service(
    session: AsyncSession = Depends(get_session),
) -> ChatService:
    return ChatService(session)


@router.get("/{exchange_id}/chat/messages", response_model=MessageListResponse)
async def list_messages(
    exchange_id: uuid.UUID,
    cursor: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=100),
    user: User = Depends(get_current_user),
    service: ChatService = Depends(_get_service),
) -> MessageListResponse:
    """Paginated message history for an exchange."""
    try:
        return await service.list_messages(exchange_id, user.id, cursor, limit)
    except ChatError as e:
        raise HTTPException(status_code=e.status_code, detail=e.code)


@router.post("/{exchange_id}/chat/read", status_code=204)
async def mark_messages_read(
    exchange_id: uuid.UUID,
    body: ChatMarkReadRequest,
    user: User = Depends(get_current_user),
    service: ChatService = Depends(_get_service),
) -> None:
    """Mark messages up to a given ID as read."""
    try:
        await service.mark_read(exchange_id, user.id, body.up_to_message_id)
    except ChatError as e:
        raise HTTPException(status_code=e.status_code, detail=e.code)


# ---------------------------------------------------------------------------
# Standalone chat list + ticket endpoints (not under /exchanges)
# ---------------------------------------------------------------------------

chat_router = APIRouter(prefix="/chat", tags=["chat"])


@chat_router.get("", response_model=ChatListResponse)
async def list_chats(
    user: User = Depends(get_current_user),
    service: ChatService = Depends(_get_service),
) -> ChatListResponse:
    """List all chats the current user participates in."""
    return await service.list_chats(user.id)


@chat_router.post("/ticket", response_model=ChatTicketResponse)
async def create_chat_ticket(
    user: User = Depends(get_current_user),
    service: ChatService = Depends(_get_service),
) -> ChatTicketResponse:
    """Obtain a single-use 30-second WebSocket ticket.

    Exchange the ticket for a WebSocket connection at ``/ws/chat?ticket=...``.
    Never put a JWT in the query string (server/proxy logs capture them).
    """
    ticket = await service.create_ticket(user.id)
    return ChatTicketResponse(ticket=ticket)


# ---------------------------------------------------------------------------
# WebSocket endpoint — mounted at root level (outside /api/v1)
# ---------------------------------------------------------------------------

ws_router = APIRouter(tags=["chat"])


@ws_router.websocket("/ws/chat")
async def websocket_endpoint(
    ws: WebSocket,
    ticket: str,
) -> None:
    """Real-time chat WebSocket.

    Authenticate with a 30-second ticket from ``POST /api/v1/chat/ticket``.
    After connecting, send JSON messages:
      ``{"type": "send", "chat_id": "<uuid>", "text": "..."}``

    The server pushes:
      ``{"type": "message", "message": {...}}``
      ``{"type": "read", "chat_id": "...", "read_by": "...", "up_to_message_id": "..."}``
      ``{"type": "error", "error": "..."}``
    """
    # 1. Validate ticket
    user_id = await consume_ticket(ticket)
    if user_id is None:
        await ws.accept()
        await ws.send_text(json.dumps({"type": "error", "error": "Invalid or expired ticket"}))
        await ws.close(code=4001)
        return

    # 2. Accept connection
    await ConnectionManager.connect(user_id, ws)

    # Create a service instance per connection for DB access
    async with get_session_factory()() as session:
        service = ChatService(session)

        try:
            while True:
                raw = await ws.receive_json()
                await service.handle_ws_message(user_id, ws, raw)
        except WebSocketDisconnect:
            pass
        except json.JSONDecodeError:
            await service._ws_error(ws, "Invalid JSON")
        except Exception:
            # Log and continue (don't crash the connection handler)
            pass
        finally:
            ConnectionManager.disconnect(user_id, ws)
