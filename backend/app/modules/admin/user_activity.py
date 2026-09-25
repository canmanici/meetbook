"""User activity detail — messages, calls, books, exchanges for a single user."""

import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import Float, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_session
from app.modules.auth.dependencies import get_admin_user
from app.modules.auth.models import User
from app.modules.books.models import Book
from app.modules.chat.models import Message
from app.modules.exchanges.models import Chat, ExchangeRequest

router = APIRouter(prefix="/admin", tags=["admin-ext"])


# ── Pydantic schemas ─────────────────────────────────────────────────────────


class ActivityMessageView(BaseModel):
    id: uuid.UUID
    chat_id: uuid.UUID
    exchange_id: uuid.UUID | None = None
    other_user_id: uuid.UUID | None = None
    other_user_name: str | None = None
    message_type: str
    text: str
    extra: dict | None = None
    created_at: datetime
    is_deleted: bool = False


class ActivityCallView(BaseModel):
    id: uuid.UUID
    chat_id: uuid.UUID
    exchange_id: uuid.UUID | None = None
    other_user_id: uuid.UUID | None = None
    other_user_name: str | None = None
    kind: str  # audio | video
    status: str  # ended | missed | failed | rejected
    duration_seconds: int
    initiated_by_me: bool
    created_at: datetime


class ActivityMessagesResponse(BaseModel):
    items: list[ActivityMessageView]
    total: int


class ActivityCallsResponse(BaseModel):
    items: list[ActivityCallView]
    total: int
    by_kind: dict = {}
    by_status: dict = {}
    total_duration_minutes: float = 0


class ActivityBooksResponse(BaseModel):
    items: list[dict]
    total: int


class ActivityExchangesResponse(BaseModel):
    items: list[dict]
    total: int


class ActivityOverviewResponse(BaseModel):
    user_id: uuid.UUID
    email: str
    name: str | None
    status: str
    is_admin: bool
    created_at: datetime
    last_active_at: datetime | None
    message_count: int = 0
    call_count: int = 0
    call_total_duration_minutes: float = 0
    book_count: int = 0
    exchange_count: int = 0


# ── Service ──────────────────────────────────────────────────────────────────


class UserActivityService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get_user(self, user_id: uuid.UUID) -> User | None:
        result = await self.session.execute(select(User).where(User.id == user_id))
        return result.scalar_one_or_none()

    async def get_messages(self, user_id: uuid.UUID, limit: int = 50, offset: int = 0) -> ActivityMessagesResponse:
        """Get all messages sent by this user across all chats."""

        # Subquery: get exchange_id for each chat
        chat_exchange = (
            select(Chat.id, Chat.exchange_request_id)
            .cte("chat_exchange")
        )

        # Also need the other user's info per chat
        # Join messages → chats → exchange_request to get other participants
        stmt = (
            select(
                Message.id,
                Message.chat_id,
                Message.message_type,
                Message.text,
                Message.extra,
                Message.created_at,
                Message.deleted_at,
                chat_exchange.c.exchange_request_id,
                User.id.label("other_user_id"),
                User.name.label("other_user_name"),
            )
            .join(chat_exchange, Message.chat_id == chat_exchange.c.id)
            .outerjoin(
                ExchangeRequest,
                chat_exchange.c.exchange_request_id == ExchangeRequest.id,
            )
            .outerjoin(
                User,
                or_(
                    User.id == ExchangeRequest.requested_by,
                    User.id == ExchangeRequest.requested_to,
                ),
            )
            .where(
                Message.sender_id == user_id,
                or_(
                    User.id != user_id,
                    User.id.is_(None),  # system messages
                ),
            )
            .order_by(Message.created_at.desc())
            .offset(offset)
            .limit(limit)
        )

        result = await self.session.execute(stmt)
        rows = result.all()

        items = []
        seen = set()
        for row in rows:
            # Deduplicate because the OR condition can produce multiple rows
            if row.id in seen:
                continue
            seen.add(row.id)
            other_id = row.other_user_id
            other_name = row.other_user_name
            # Filter out rows where the "other" user is actually the same user
            if other_id and other_id == user_id:
                continue
            items.append(ActivityMessageView(
                id=row.id,
                chat_id=row.chat_id,
                exchange_id=row.exchange_request_id,
                other_user_id=other_id,
                other_user_name=other_name,
                message_type=row.message_type,
                text=row.text,
                extra=row.extra,
                created_at=row.created_at,
                is_deleted=row.deleted_at is not None,
            ))

        # Count total
        count_stmt = (
            select(func.count(Message.id))
            .where(Message.sender_id == user_id)
        )
        total_result = await self.session.execute(count_stmt)
        total = total_result.scalar() or 0

        return ActivityMessagesResponse(items=items, total=total)

    async def get_calls(self, user_id: uuid.UUID, limit: int = 50, offset: int = 0) -> ActivityCallsResponse:
        """Get all call_log messages involving this user."""

        # Get chats this user participates in
        user_chats = (
            select(Message.chat_id)
            .where(Message.sender_id == user_id)
            .distinct()
            .cte("user_chats")
        )

        # Get all call_log entries in those chats
        # A call_log has: extra->>'action' = 'call_log'
        call_log_expr = Message.extra["action"].astext == "call_log"

        stmt = (
            select(
                Message.id,
                Message.chat_id,
                Message.sender_id,
                Message.text,
                Message.extra,
                Message.created_at,
                user_chats.c.chat_id,
            )
            .join(user_chats, Message.chat_id == user_chats.c.chat_id)
            .where(call_log_expr)
            .order_by(Message.created_at.desc())
            .offset(offset)
            .limit(limit)
        )

        result = await self.session.execute(stmt)
        rows = result.all()

        # Deduplicate by id
        seen = set()
        items = []
        by_kind: dict[str, int] = {}
        by_status: dict[str, int] = {}
        total_duration = 0.0

        for row in rows:
            if row.id in seen:
                continue
            seen.add(row.id)
            extra = row.extra or {}
            kind = extra.get("kind", "audio")
            status = extra.get("status", "unknown")
            duration = extra.get("duration_seconds", 0)

            by_kind[kind] = by_kind.get(kind, 0) + 1
            by_status[status] = by_status.get(status, 0) + 1
            total_duration += duration

            # Get exchange_id for this chat
            chat_exch = await self.session.execute(
                select(Chat.exchange_request_id).where(Chat.id == row.chat_id)
            )
            exch_id = chat_exch.scalar_one_or_none()

            # Get the other user
            other_id = None
            other_name = None
            if exch_id:
                exch = await self.session.get(ExchangeRequest, exch_id)
                if exch:
                    if exch.requested_by == user_id:
                        other_id = exch.requested_to
                    elif exch.requested_to == user_id:
                        other_id = exch.requested_by
                    if other_id:
                        other_user = await self.session.get(User, other_id)
                        if other_user:
                            other_name = other_user.name or other_user.email

            initiated_by_me = row.sender_id == user_id

            items.append(ActivityCallView(
                id=row.id,
                chat_id=row.chat_id,
                exchange_id=exch_id,
                other_user_id=other_id,
                other_user_name=other_name,
                kind=kind,
                status=status,
                duration_seconds=duration,
                initiated_by_me=initiated_by_me,
                created_at=row.created_at,
            ))

        # Count total calls involving user (in chats they participate in)
        count_stmt = (
            select(func.count(Message.id))
            .where(
                Message.chat_id.in_(
                    select(Message.chat_id)
                    .where(Message.sender_id == user_id)
                    .distinct()
                ),
                call_log_expr,
            )
        )
        total_result = await self.session.execute(count_stmt)
        total = total_result.scalar() or 0

        return ActivityCallsResponse(
            items=items,
            total=total,
            by_kind=by_kind,
            by_status=by_status,
            total_duration_minutes=round(total_duration / 60, 1),
        )

    async def get_overview(self, user_id: uuid.UUID) -> ActivityOverviewResponse | None:
        user = await self.session.get(User, user_id)
        if not user:
            return None

        # Count messages
        msg_result = await self.session.execute(
            select(func.count(Message.id)).where(Message.sender_id == user_id)
        )
        msg_count = msg_result.scalar() or 0

        # Count calls involving user (in their chats)
        user_chat_ids = (
            select(Message.chat_id)
            .where(Message.sender_id == user_id)
            .distinct()
        )
        call_count_result = await self.session.execute(
            select(func.count(Message.id)).where(
                Message.chat_id.in_(user_chat_ids),
                Message.extra["action"].astext == "call_log",
            )
        )
        call_count = call_count_result.scalar() or 0

        # Total call duration - use raw SQL for JSONB float sum
        dur_result = await self.session.execute(
            select(func.coalesce(
                func.sum(
                    func.cast(
                        Message.extra["duration_seconds"].astext,
                        Float,
                    )
                ), 0
            )).where(
                Message.chat_id.in_(
                    select(Message.chat_id)
                    .where(Message.sender_id == user_id)
                    .distinct()
                ),
                Message.extra["action"].astext == "call_log",
            )
        )
        total_dur = 0
        try:
            total_dur = float(dur_result.scalar() or 0)
        except (TypeError, ValueError):
            total_dur = 0

        # Count books
        book_result = await self.session.execute(
            select(func.count(Book.id)).where(Book.owner_id == user_id)
        )
        book_count = book_result.scalar() or 0

        # Count exchanges
        exch_result = await self.session.execute(
            select(func.count(ExchangeRequest.id)).where(
                or_(
                    ExchangeRequest.requested_by == user_id,
                    ExchangeRequest.requested_to == user_id,
                )
            )
        )
        exch_count = exch_result.scalar() or 0

        return ActivityOverviewResponse(
            user_id=user.id,
            email=user.email,
            name=user.name,
            status=user.status.value if hasattr(user.status, 'value') else str(user.status),
            is_admin=user.is_admin or False,
            created_at=user.created_at,
            last_active_at=user.last_active_at,
            message_count=msg_count,
            call_count=call_count,
            call_total_duration_minutes=round(total_dur / 60, 1),
            book_count=book_count,
            exchange_count=exch_count,
        )


# ── Routes ───────────────────────────────────────────────────────────────────


def _get_service(session: AsyncSession = Depends(get_session)) -> UserActivityService:
    return UserActivityService(session)


@router.get("/users/{user_id}/activity/overview", response_model=ActivityOverviewResponse)
async def get_user_activity_overview(
    user_id: uuid.UUID,
    user: User = Depends(get_admin_user),
    service: UserActivityService = Depends(_get_service),
) -> ActivityOverviewResponse:
    overview = await service.get_overview(user_id)
    if overview is None:
        raise HTTPException(status_code=404, detail="USER_NOT_FOUND")
    return overview


@router.get("/users/{user_id}/activity/messages", response_model=ActivityMessagesResponse)
async def get_user_activity_messages(
    user_id: uuid.UUID,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    user: User = Depends(get_admin_user),
    service: UserActivityService = Depends(_get_service),
) -> ActivityMessagesResponse:
    return await service.get_messages(user_id, limit, offset)


@router.get("/users/{user_id}/activity/calls", response_model=ActivityCallsResponse)
async def get_user_activity_calls(
    user_id: uuid.UUID,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    user: User = Depends(get_admin_user),
    service: UserActivityService = Depends(_get_service),
) -> ActivityCallsResponse:
    return await service.get_calls(user_id, limit, offset)
