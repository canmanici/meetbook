"""Admin chat message reading — moderation feature for reading conversations."""

import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_session
from app.modules.auth.dependencies import get_admin_user
from app.modules.auth.models import User
from app.modules.chat.models import Message
from app.modules.exchanges.models import Chat, ExchangeRequest
from app.modules.reports.models import Report, ReportTarget

router = APIRouter(prefix="/admin", tags=["admin-ext"])


# ── Pydantic schemas ─────────────────────────────────────────────────────────


class ChatView(BaseModel):
    id: uuid.UUID
    exchange_id: uuid.UUID
    created_at: datetime


class MessageView(BaseModel):
    id: uuid.UUID
    chat_id: uuid.UUID
    sender_id: uuid.UUID | None
    sender_name: str | None
    sender_email: str | None
    message_type: str
    text: str
    extra: dict | None
    created_at: datetime
    read_at: datetime | None
    deleted_at: datetime | None
    is_deleted: bool


class ChatMessagesResponse(BaseModel):
    items: list[MessageView]
    total: int
    chat_id: uuid.UUID


class UserChatView(BaseModel):
    chat_id: uuid.UUID
    exchange_id: uuid.UUID
    other_user_id: uuid.UUID
    other_user_name: str
    other_user_email: str
    last_message_at: datetime | None
    last_message_text: str | None
    unread_count: int


class UserChatListResponse(BaseModel):
    items: list[UserChatView]
    total: int


class ReportInfo(BaseModel):
    id: uuid.UUID
    target_type: str
    target_id: uuid.UUID
    reason: str
    reporter_id: uuid.UUID
    created_at: datetime


class ChatContextResponse(BaseModel):
    report: ReportInfo
    chat: ChatView | None
    messages: list[MessageView] | None


# ── Service ──────────────────────────────────────────────────────────────────


class ChatAdminService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get_chat_by_exchange(self, exchange_id: uuid.UUID) -> ChatView:
        exch = await self.session.get(ExchangeRequest, exchange_id)
        if not exch:
            raise HTTPException(status_code=404, detail="EXCHANGE_NOT_FOUND")

        stmt = select(Chat).where(Chat.exchange_request_id == exchange_id)
        result = await self.session.execute(stmt)
        chat = result.scalar_one_or_none()
        if not chat:
            raise HTTPException(status_code=404, detail="CHAT_NOT_FOUND")

        return ChatView(
            id=chat.id,
            exchange_id=chat.exchange_request_id,
            created_at=chat.created_at,
        )

    async def get_chat_messages(
        self,
        chat_id: uuid.UUID,
        limit: int = 50,
        offset: int = 0,
    ) -> dict:
        chat = await self.session.get(Chat, chat_id)
        if not chat:
            raise HTTPException(status_code=404, detail="CHAT_NOT_FOUND")

        count_stmt = select(func.count(Message.id)).where(
            Message.chat_id == chat_id,
        )
        total = await self.session.scalar(count_stmt) or 0

        stmt = (
            select(Message, User)
            .outerjoin(User, Message.sender_id == User.id)
            .where(Message.chat_id == chat_id)
            .order_by(Message.created_at.desc())
            .offset(offset)
            .limit(limit)
        )
        result = await self.session.execute(stmt)
        rows = result.all()

        items: list[MessageView] = []
        for msg, sender in rows:
            is_deleted = msg.deleted_at is not None
            text = "[Mesaj silindi]" if is_deleted else (msg.text or "")
            items.append(
                MessageView(
                    id=msg.id,
                    chat_id=msg.chat_id,
                    sender_id=msg.sender_id,
                    sender_name=sender.name
                    if sender
                    else ("Sistem" if msg.sender_id is None else "Silinmiş Kullanıcı"),
                    sender_email=sender.email if sender else None,
                    message_type=msg.message_type,
                    text=text,
                    extra=msg.extra,
                    created_at=msg.created_at,
                    read_at=msg.read_at,
                    deleted_at=msg.deleted_at,
                    is_deleted=is_deleted,
                )
            )

        return {"items": items, "total": total, "chat_id": chat_id}

    async def get_user_chats(
        self,
        user_id: uuid.UUID,
        limit: int = 50,
        offset: int = 0,
    ) -> dict:
        count_stmt = (
            select(func.count(Chat.id))
            .join(ExchangeRequest, Chat.exchange_request_id == ExchangeRequest.id)
            .where(
                or_(
                    ExchangeRequest.requested_by == user_id,
                    ExchangeRequest.requested_to == user_id,
                )
            )
        )
        total = await self.session.scalar(count_stmt) or 0

        stmt = (
            select(Chat, ExchangeRequest)
            .join(ExchangeRequest, Chat.exchange_request_id == ExchangeRequest.id)
            .where(
                or_(
                    ExchangeRequest.requested_by == user_id,
                    ExchangeRequest.requested_to == user_id,
                )
            )
            .order_by(Chat.created_at.desc())
            .offset(offset)
            .limit(limit)
        )
        result = await self.session.execute(stmt)
        rows = result.all()

        items: list[UserChatView] = []
        for chat, exch in rows:
            other_user_id = (
                exch.requested_to if exch.requested_by == user_id else exch.requested_by
            )

            other_user = await self.session.get(User, other_user_id)

            last_msg_stmt = (
                select(Message)
                .where(Message.chat_id == chat.id)
                .order_by(Message.created_at.desc())
                .limit(1)
            )
            last_msg_result = await self.session.execute(last_msg_stmt)
            last_msg = last_msg_result.scalar_one_or_none()

            unread_stmt = (
                select(func.count(Message.id))
                .where(
                    Message.chat_id == chat.id,
                    Message.sender_id.isnot(None),
                    Message.sender_id != user_id,
                    Message.read_at.is_(None),
                    Message.deleted_at.is_(None),
                )
            )
            unread_count = await self.session.scalar(unread_stmt) or 0

            last_msg_text: str | None = None
            if last_msg:
                if last_msg.deleted_at is not None:
                    last_msg_text = "[Mesaj silindi]"
                else:
                    last_msg_text = (last_msg.text or "")[:100]

            items.append(
                UserChatView(
                    chat_id=chat.id,
                    exchange_id=chat.exchange_request_id,
                    other_user_id=other_user_id,
                    other_user_name=other_user.name if other_user else "Silinmiş Kullanıcı",
                    other_user_email=other_user.email if other_user else "",
                    last_message_at=last_msg.created_at if last_msg else None,
                    last_message_text=last_msg_text,
                    unread_count=unread_count,
                )
            )

        return {"items": items, "total": total}

    async def get_chat_context(self, report_id: uuid.UUID) -> dict:
        report = await self.session.get(Report, report_id)
        if not report:
            raise HTTPException(status_code=404, detail="REPORT_NOT_FOUND")

        target_type_str = (
            report.target_type.value
            if hasattr(report.target_type, "value")
            else str(report.target_type)
        )

        report_info = ReportInfo(
            id=report.id,
            target_type=target_type_str,
            target_id=report.target_id,
            reason=report.reason,
            reporter_id=report.reporter_id,
            created_at=report.created_at,
        )

        chat_id: uuid.UUID | None = None

        if report.target_type == ReportTarget.message or target_type_str == "message":
            msg = await self.session.get(Message, report.target_id)
            if msg:
                chat_id = msg.chat_id
        elif target_type_str == "exchange":
            stmt = select(Chat).where(Chat.exchange_request_id == report.target_id)
            result = await self.session.execute(stmt)
            chat = result.scalar_one_or_none()
            if chat:
                chat_id = chat.id

        if chat_id is None:
            return {"report": report_info, "chat": None, "messages": None}

        chat = await self.session.get(Chat, chat_id)
        chat_view = ChatView(
            id=chat.id,
            exchange_id=chat.exchange_request_id,
            created_at=chat.created_at,
        )

        msg_result = await self.get_chat_messages(chat_id, limit=50, offset=0)
        messages = list(reversed(msg_result["items"]))

        return {"report": report_info, "chat": chat_view, "messages": messages}


# ── Dependency ───────────────────────────────────────────────────────────────


def _get_chat_admin_service(
    session: AsyncSession = Depends(get_session),
) -> ChatAdminService:
    return ChatAdminService(session)


# ── Endpoints ────────────────────────────────────────────────────────────────


@router.get("/chats/by-exchange/{exchange_id}", response_model=ChatView)
async def get_chat_by_exchange(
    exchange_id: uuid.UUID,
    user: User = Depends(get_admin_user),
    service: ChatAdminService = Depends(_get_chat_admin_service),
) -> ChatView:
    """Get the chat for a given exchange."""
    return await service.get_chat_by_exchange(exchange_id)


@router.get("/chats/{chat_id}/messages", response_model=ChatMessagesResponse)
async def get_chat_messages(
    chat_id: uuid.UUID,
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    user: User = Depends(get_admin_user),
    service: ChatAdminService = Depends(_get_chat_admin_service),
) -> ChatMessagesResponse:
    """Paginated messages for a chat (newest first)."""
    return await service.get_chat_messages(chat_id, limit, offset)


@router.get("/chats/by-user/{user_id}", response_model=UserChatListResponse)
async def get_user_chats(
    user_id: uuid.UUID,
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    user: User = Depends(get_admin_user),
    service: ChatAdminService = Depends(_get_chat_admin_service),
) -> UserChatListResponse:
    """List all chats a user participates in."""
    return await service.get_user_chats(user_id, limit, offset)


@router.get("/reports/{report_id}/chat-context", response_model=ChatContextResponse)
async def get_chat_context(
    report_id: uuid.UUID,
    user: User = Depends(get_admin_user),
    service: ChatAdminService = Depends(_get_chat_admin_service),
) -> ChatContextResponse:
    """Chat messages context for a report (message or exchange target)."""
    return await service.get_chat_context(report_id)
