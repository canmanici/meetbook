"""Message analytics + session/device analytics — computed from messages and refresh_tokens."""

import uuid
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_session
from app.modules.auth.dependencies import get_admin_user
from app.modules.auth.models import User, RefreshToken
from app.modules.chat.models import Message

router = APIRouter(prefix="/admin", tags=["admin-ext"])


# ── Schemas ──────────────────────────────────────────────────────────────────


class TrendPoint(BaseModel):
    date: str
    value: int


class SenderItem(BaseModel):
    user_id: uuid.UUID | None
    name: str
    email: str
    message_count: int


class ChatActivityItem(BaseModel):
    chat_id: uuid.UUID
    exchange_id: uuid.UUID | None
    message_count: int


class MessageMetricsResponse(BaseModel):
    total_messages: int
    messages_30d: int
    messages_today: int
    by_type: dict[str, int]
    top_senders: list[SenderItem]
    most_active_chats: list[ChatActivityItem]
    daily_trend: list[TrendPoint]
    peak_hour_distribution: list[dict]


class DeviceItem(BaseModel):
    model: str
    count: int


class SessionMetricsResponse(BaseModel):
    total_sessions: int
    active_sessions_30d: int
    device_type_breakdown: dict[str, int]
    os_version_breakdown: dict[str, int]
    sessions_per_user_avg: float
    unique_users_with_sessions: int
    sessions_created_per_day: list[TrendPoint]
    most_used_devices: list[DeviceItem]


# ── Service ──────────────────────────────────────────────────────────────────


class MessagesMetricsService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def _scalar(self, stmt):
        result = await self.session.execute(stmt)
        return result.scalar()

    async def get_message_metrics(self) -> MessageMetricsResponse:
        now = datetime.now(UTC)
        today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        days_30_ago = now - timedelta(days=30)

        total_messages = await self._scalar(
            select(func.count()).select_from(Message)
        ) or 0

        messages_30d = await self._scalar(
            select(func.count()).select_from(Message).where(
                Message.created_at >= days_30_ago,
            )
        ) or 0

        messages_today = await self._scalar(
            select(func.count()).select_from(Message).where(
                Message.created_at >= today_start,
            )
        ) or 0

        by_type_rows = await self.session.execute(
            select(Message.message_type, func.count().label("cnt"))
            .group_by(Message.message_type)
            .order_by(text("cnt DESC"))
        )
        by_type = {r[0]: r[1] for r in by_type_rows.all()}

        top_senders_rows = await self.session.execute(
            text("""
                SELECT m.sender_id, u.name, u.email, count(*) AS cnt
                FROM messages m
                LEFT JOIN users u ON u.id = m.sender_id
                WHERE m.sender_id IS NOT NULL
                GROUP BY m.sender_id, u.name, u.email
                ORDER BY cnt DESC
                LIMIT 10
            """)
        )
        top_senders = [
            SenderItem(user_id=r[0], name=r[1] or "Sistem", email=r[2] or "system", message_count=r[3])
            for r in top_senders_rows.all()
        ]

        most_active_chats_rows = await self.session.execute(
            text("""
                SELECT m.chat_id, er.id AS exchange_id, count(*) AS cnt
                FROM messages m
                LEFT JOIN chats c ON c.id = m.chat_id
                LEFT JOIN exchange_requests er ON er.id = c.exchange_request_id
                GROUP BY m.chat_id, er.id
                ORDER BY cnt DESC
                LIMIT 10
            """)
        )
        most_active_chats = [
            ChatActivityItem(chat_id=r[0], exchange_id=r[1], message_count=r[2])
            for r in most_active_chats_rows.all()
        ]

        daily_rows = await self.session.execute(
            text("""
                SELECT date_trunc('day', created_at)::date AS day, count(*) AS cnt
                FROM messages
                WHERE created_at >= :cutoff
                GROUP BY day
                ORDER BY day
            """).bindparams(cutoff=days_30_ago)
        )
        daily_map = {str(r[0]): r[1] for r in daily_rows.all()}

        daily_trend = []
        for i in range(30):
            d = (days_30_ago + timedelta(days=i)).strftime("%Y-%m-%d")
            daily_trend.append(TrendPoint(date=d, value=daily_map.get(d, 0)))

        hour_rows = await self.session.execute(
            text("""
                SELECT EXTRACT(HOUR FROM created_at)::int AS hour, count(*) AS cnt
                FROM messages
                WHERE created_at >= :cutoff
                GROUP BY hour
                ORDER BY hour
            """).bindparams(cutoff=days_30_ago)
        )
        peak_hour_distribution = [{"hour": r[0], "count": r[1]} for r in hour_rows.all()]

        return MessageMetricsResponse(
            total_messages=total_messages,
            messages_30d=messages_30d,
            messages_today=messages_today,
            by_type=by_type,
            top_senders=top_senders,
            most_active_chats=most_active_chats,
            daily_trend=daily_trend,
            peak_hour_distribution=peak_hour_distribution,
        )

    async def get_session_metrics(self) -> SessionMetricsResponse:
        now = datetime.now(UTC)
        days_30_ago = now - timedelta(days=30)

        total_sessions = await self._scalar(
            select(func.count()).select_from(RefreshToken).where(
                RefreshToken.revoked_at.is_(None),
            )
        ) or 0

        active_sessions_30d = await self._scalar(
            select(func.count()).select_from(RefreshToken).where(
                RefreshToken.created_at >= days_30_ago,
                RefreshToken.revoked_at.is_(None),
            )
        ) or 0

        device_os_rows = await self.session.execute(
            text("""
                SELECT COALESCE(device_info->>'os', 'Unknown') AS os, count(*) AS cnt
                FROM refresh_tokens
                WHERE device_info IS NOT NULL
                GROUP BY os
                ORDER BY cnt DESC
            """)
        )
        device_type_breakdown = {r[0]: r[1] for r in device_os_rows.all()}

        os_version_rows = await self.session.execute(
            text("""
                SELECT COALESCE(device_info->>'os', 'Unknown')
                       || ' '
                       || COALESCE(device_info->>'os_version', 'Unknown') AS os_ver,
                       count(*) AS cnt
                FROM refresh_tokens
                WHERE device_info IS NOT NULL
                GROUP BY os_ver
                ORDER BY cnt DESC
            """)
        )
        os_version_breakdown = {r[0]: r[1] for r in os_version_rows.all()}

        unique_users = await self._scalar(
            select(func.count(func.distinct(RefreshToken.user_id))).select_from(RefreshToken)
        ) or 0

        sessions_per_user_avg = round(total_sessions / max(unique_users, 1), 2)

        session_daily_rows = await self.session.execute(
            text("""
                SELECT date_trunc('day', created_at)::date AS day, count(*) AS cnt
                FROM refresh_tokens
                WHERE created_at >= :cutoff
                GROUP BY day
                ORDER BY day
            """).bindparams(cutoff=days_30_ago)
        )
        daily_map = {str(r[0]): r[1] for r in session_daily_rows.all()}

        sessions_created_per_day = []
        for i in range(30):
            d = (days_30_ago + timedelta(days=i)).strftime("%Y-%m-%d")
            sessions_created_per_day.append(TrendPoint(date=d, value=daily_map.get(d, 0)))

        device_model_rows = await self.session.execute(
            text("""
                SELECT COALESCE(device_info->>'device_model', 'Unknown') AS model, count(*) AS cnt
                FROM refresh_tokens
                WHERE device_info IS NOT NULL
                GROUP BY model
                ORDER BY cnt DESC
                LIMIT 10
            """)
        )
        most_used_devices = [
            DeviceItem(model=r[0], count=r[1]) for r in device_model_rows.all()
        ]

        return SessionMetricsResponse(
            total_sessions=total_sessions,
            active_sessions_30d=active_sessions_30d,
            device_type_breakdown=device_type_breakdown,
            os_version_breakdown=os_version_breakdown,
            sessions_per_user_avg=sessions_per_user_avg,
            unique_users_with_sessions=unique_users,
            sessions_created_per_day=sessions_created_per_day,
            most_used_devices=most_used_devices,
        )


# ── DI ────────────────────────────────────────────────────────────────────────


def _get_service(session: AsyncSession = Depends(get_session)) -> MessagesMetricsService:
    return MessagesMetricsService(session)


# ── Endpoints ─────────────────────────────────────────────────────────────────


@router.get("/metrics/messages", response_model=MessageMetricsResponse)
async def get_message_metrics(
    user: User = Depends(get_admin_user),
    service: MessagesMetricsService = Depends(_get_service),
) -> MessageMetricsResponse:
    return await service.get_message_metrics()


@router.get("/metrics/sessions", response_model=SessionMetricsResponse)
async def get_session_metrics(
    user: User = Depends(get_admin_user),
    service: MessagesMetricsService = Depends(_get_service),
) -> SessionMetricsResponse:
    return await service.get_session_metrics()
