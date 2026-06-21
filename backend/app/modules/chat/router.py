"""Chat REST + WebSocket endpoints — full-featured WhatsApp-grade API."""

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
    ChatSettingsRequest,
    ChatSettingsResponse,
    ChatSettingsView,
    ChatTicketResponse,
    MessageDeliveryInfo,
    MessageListResponse,
    MessageSearchResponse,
    MessageSearchResult,
    MessageView,
    PinnedMessagesResponse,
    ReactionRequest,
    StarredMessagesResponse,
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


# ── Messages ──────────────────────────────────────────────────────────────


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


@router.get("/{exchange_id}/chat/messages/search", response_model=MessageSearchResponse)
async def search_messages(
    exchange_id: uuid.UUID,
    q: str = Query(..., min_length=1, max_length=100),
    limit: int = Query(default=50, ge=1, le=100),
    user: User = Depends(get_current_user),
    service: ChatService = Depends(_get_service),
) -> MessageSearchResponse:
    """Search messages within an exchange chat."""
    try:
        messages = await service.search_messages(exchange_id, user.id, q)
        items = [MessageSearchResult(message=m) for m in messages]
        return MessageSearchResponse(items=items, total=len(items))
    except ChatError as e:
        raise HTTPException(status_code=e.status_code, detail=e.code)


@router.get("/{exchange_id}/chat/messages/pinned", response_model=PinnedMessagesResponse)
async def get_pinned_messages(
    exchange_id: uuid.UUID,
    user: User = Depends(get_current_user),
    service: ChatService = Depends(_get_service),
) -> PinnedMessagesResponse:
    """Get all pinned messages in a chat."""
    try:
        messages = await service.get_pinned_messages(exchange_id, user.id)
        return PinnedMessagesResponse(items=messages)
    except ChatError as e:
        raise HTTPException(status_code=e.status_code, detail=e.code)


@router.post("/{exchange_id}/chat/messages/{message_id}/star")
async def toggle_star(
    exchange_id: uuid.UUID,
    message_id: uuid.UUID,
    user: User = Depends(get_current_user),
    service: ChatService = Depends(_get_service),
) -> dict:
    """Toggle star on a message."""
    result = await service.repo.toggle_star(message_id)
    await service.session.commit()
    return {"starred": result}


@router.post("/{exchange_id}/chat/messages/{message_id}/pin")
async def toggle_pin(
    exchange_id: uuid.UUID,
    message_id: uuid.UUID,
    user: User = Depends(get_current_user),
    service: ChatService = Depends(_get_service),
) -> dict:
    """Toggle pin on a message."""
    result = await service.repo.toggle_pin(message_id)
    await service.session.commit()
    return {"pinned": result}


@router.get("/{exchange_id}/chat/messages/{message_id}/info", response_model=MessageDeliveryInfo)
async def get_message_info(
    exchange_id: uuid.UUID,
    message_id: uuid.UUID,
    user: User = Depends(get_current_user),
    service: ChatService = Depends(_get_service),
) -> MessageDeliveryInfo:
    """Get delivery info for a message (sent, delivered, read timestamps)."""
    info = await service.get_message_delivery_info(message_id, user.id)
    if info is None:
        raise HTTPException(status_code=404, detail="Message not found")
    return info


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


# ── Chat settings ─────────────────────────────────────────────────────────


@router.get("/{exchange_id}/chat/settings", response_model=ChatSettingsResponse)
async def get_chat_settings(
    exchange_id: uuid.UUID,
    user: User = Depends(get_current_user),
    service: ChatService = Depends(_get_service),
) -> ChatSettingsResponse:
    """Get chat settings for the current user."""
    try:
        settings = await service.get_chat_settings(exchange_id, user.id)
        return ChatSettingsResponse(settings=settings)
    except ChatError as e:
        raise HTTPException(status_code=e.status_code, detail=e.code)


@router.patch("/{exchange_id}/chat/settings", response_model=ChatSettingsResponse)
async def update_chat_settings(
    exchange_id: uuid.UUID,
    body: ChatSettingsRequest,
    user: User = Depends(get_current_user),
    service: ChatService = Depends(_get_service),
) -> ChatSettingsResponse:
    """Update chat settings (mute, wallpaper, font size, notification sound)."""
    try:
        settings = await service.update_chat_settings(
            exchange_id,
            user.id,
            is_muted=body.is_muted,
            wallpaper_url=body.wallpaper_url,
            font_size=body.font_size,
            notification_sound=body.notification_sound,
        )
        return ChatSettingsResponse(settings=settings)
    except ChatError as e:
        raise HTTPException(status_code=e.status_code, detail=e.code)


# ── Standalone chat list + ticket + starred ───────────────────────────────

chat_router = APIRouter(prefix="/chat", tags=["chat"])


@chat_router.get("", response_model=ChatListResponse)
async def list_chats(
    user: User = Depends(get_current_user),
    service: ChatService = Depends(_get_service),
) -> ChatListResponse:
    """List all chats the current user participates in."""
    return await service.list_chats(user.id)


@chat_router.get("/starred", response_model=StarredMessagesResponse)
async def list_starred_messages(
    user: User = Depends(get_current_user),
    service: ChatService = Depends(_get_service),
) -> StarredMessagesResponse:
    """List all starred messages across all chats."""
    messages = await service.get_starred_messages(user.id)
    return StarredMessagesResponse(items=messages)


@chat_router.post("/ticket", response_model=ChatTicketResponse)
async def create_chat_ticket(
    user: User = Depends(get_current_user),
    service: ChatService = Depends(_get_service),
) -> ChatTicketResponse:
    """Obtain a single-use 30-second WebSocket ticket."""
    ticket = await service.create_ticket(user.id)
    return ChatTicketResponse(ticket=ticket)


# ---------------------------------------------------------------------------
# WebSocket endpoint
# ---------------------------------------------------------------------------

ws_router = APIRouter(tags=["chat"])


@ws_router.websocket("/ws/chat")
async def websocket_endpoint(
    ws: WebSocket,
    ticket: str,
) -> None:
    """Real-time chat WebSocket — full-featured protocol.

    Client → Server:
      {"type": "send", "chat_id": "...", "text": "...", "reply_to_id": "...", "message_type": "text|image|voice|location|book_card", "extra": {...}}
      {"type": "typing", "chat_id": "...", "is_typing": true}
      {"type": "delete", "chat_id": "...", "message_id": "..."}
      {"type": "reaction", "chat_id": "...", "message_id": "...", "emoji": "👍", "action": "add|remove"}
      {"type": "presence"}
      {"type": "ping"}

    Server → Client:
      {"type": "message", "message": {...}, "sender_id": "..."}
      {"type": "read", "chat_id": "...", "read_by": "...", "up_to_message_id": "..."}
      {"type": "typing", "chat_id": "...", "user_id": "...", "is_typing": true}
      {"type": "reaction", "chat_id": "...", "message_id": "...", "reactions": [...]}
      {"type": "deleted", "chat_id": "...", "message_id": "..."}
      {"type": "presence", "user_id": "...", "is_online": true}
      {"type": "error", "error": "..."}
      {"type": "pong"}
    """
    user_id = await consume_ticket(ticket)
    if user_id is None:
        await ws.accept()
        await ws.send_text(json.dumps({"type": "error", "error": "Invalid or expired ticket"}))
        await ws.close(code=4001)
        return

    await ConnectionManager.connect(user_id, ws)

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
            pass
        finally:
            ConnectionManager.disconnect(user_id, ws)
            await ConnectionManager.set_last_seen(user_id)
            await ConnectionManager._broadcast_presence(user_id, False)
