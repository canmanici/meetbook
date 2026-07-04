"""Call/WebRTC analytics — computed from system call_log messages."""

import uuid
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_session
from app.modules.auth.dependencies import get_admin_user
from app.modules.auth.models import User
from app.modules.chat.models import Message

router = APIRouter(prefix="/admin", tags=["admin-ext"])


# ── Schemas ──────────────────────────────────────────────────────────────────


class TrendPoint(BaseModel):
    date: str
    value: int


class CallerItem(BaseModel):
    user_id: uuid.UUID
    name: str
    email: str
    call_count: int
    total_duration_seconds: int


class CallMetricsResponse(BaseModel):
    total_calls: int
    by_kind: dict[str, int]
    by_status: dict[str, int]
    avg_duration_seconds: float | None
    total_duration_minutes: float
    longest_call_seconds: int | None
    calls_today: int
    calls_30d: int
    calls_per_day_trend: list[TrendPoint]
    top_callers: list[CallerItem]


class CallTrendsResponse(BaseModel):
    by_kind: list[TrendPoint]
    by_status: list[TrendPoint]


# ── Service ──────────────────────────────────────────────────────────────────


class CallMetricsService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get_call_metrics(self) -> CallMetricsResponse:
        now = datetime.now(UTC)
        today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        days_30_ago = now - timedelta(days=30)

        total_calls = await self._scalar(
            select(func.count()).select_from(Message).where(
                Message.message_type == "system",
                Message.extra["action"].astext == "call_log",
            )
        ) or 0

        kind_rows = await self.session.execute(
            text("""
                SELECT extra->>'kind' AS kind, count(*) AS cnt
                FROM messages
                WHERE message_type = 'system' AND extra->>'action' = 'call_log'
                GROUP BY kind
            """)
        )
        by_kind = {r[0]: r[1] for r in kind_rows.all()}

        status_rows = await self.session.execute(
            text("""
                SELECT extra->>'status' AS status, count(*) AS cnt
                FROM messages
                WHERE message_type = 'system' AND extra->>'action' = 'call_log'
                GROUP BY status
            """)
        )
        by_status = {r[0]: r[1] for r in status_rows.all()}

        avg_duration = await self._scalar(
            text("""
                SELECT avg((extra->>'duration_seconds')::int)
                FROM messages
                WHERE message_type = 'system'
                  AND extra->>'action' = 'call_log'
                  AND extra->>'status' = 'ended'
                  AND extra->>'duration_seconds' IS NOT NULL
            """)
        )
        avg_sec = round(float(avg_duration), 1) if avg_duration else None

        total_duration = await self._scalar(
            text("""
                SELECT coalesce(sum((extra->>'duration_seconds')::int), 0)
                FROM messages
                WHERE message_type = 'system'
                  AND extra->>'action' = 'call_log'
                  AND extra->>'status' = 'ended'
            """)
        ) or 0

        longest_call = await self._scalar(
            text("""
                SELECT max((extra->>'duration_seconds')::int)
                FROM messages
                WHERE message_type = 'system'
                  AND extra->>'action' = 'call_log'
                  AND extra->>'status' = 'ended'
                  AND extra->>'duration_seconds' IS NOT NULL
            """)
        )

        calls_today = await self._scalar(
            text("""
                SELECT count(*)
                FROM messages
                WHERE message_type = 'system'
                  AND extra->>'action' = 'call_log'
                  AND created_at >= :today
            """).bindparams(today=today_start)
        ) or 0

        calls_30d = await self._scalar(
            text("""
                SELECT count(*)
                FROM messages
                WHERE message_type = 'system'
                  AND extra->>'action' = 'call_log'
                  AND created_at >= :cutoff
            """).bindparams(cutoff=days_30_ago)
        ) or 0

        date_spine = [
            (days_30_ago + timedelta(days=i)).strftime("%Y-%m-%d")
            for i in range(31)
        ]
        trend_rows = await self.session.execute(
            text("""
                SELECT date_trunc('day', created_at)::date AS day, count(*) AS cnt
                FROM messages
                WHERE message_type = 'system'
                  AND extra->>'action' = 'call_log'
                  AND created_at >= :cutoff
                GROUP BY day ORDER BY day
            """).bindparams(cutoff=days_30_ago)
        )
        trend_lookup = {str(r[0]): r[1] for r in trend_rows.all()}
        calls_per_day_trend = [
            TrendPoint(date=d, value=trend_lookup.get(d, 0)) for d in date_spine
        ]

        caller_rows = await self.session.execute(
            text("""
                SELECT u.id, u.name, u.email,
                       count(*) AS call_count,
                       coalesce(sum((m.extra->>'duration_seconds')::int), 0) AS total_dur
                FROM messages m
                JOIN users u ON u.id = m.sender_id
                WHERE m.message_type = 'system'
                  AND m.extra->>'action' = 'call_log'
                GROUP BY u.id, u.name, u.email
                ORDER BY call_count DESC
                LIMIT 10
            """)
        )
        top_callers = [
            CallerItem(
                user_id=uuid.UUID(str(r[0])) if not isinstance(r[0], uuid.UUID) else r[0],
                name=r[1],
                email=r[2],
                call_count=r[3],
                total_duration_seconds=r[4] or 0,
            )
            for r in caller_rows.all()
        ]

        return CallMetricsResponse(
            total_calls=total_calls,
            by_kind=by_kind,
            by_status=by_status,
            avg_duration_seconds=avg_sec,
            total_duration_minutes=round(total_duration / 60.0, 1),
            longest_call_seconds=longest_call,
            calls_today=calls_today,
            calls_30d=calls_30d,
            calls_per_day_trend=calls_per_day_trend,
            top_callers=top_callers,
        )

    async def get_call_trends(self, days: int = 30) -> CallTrendsResponse:
        now = datetime.now(UTC)
        cutoff = now - timedelta(days=days)
        date_spine = [
            (cutoff + timedelta(days=i)).strftime("%Y-%m-%d") for i in range(days + 1)
        ]

        rows = await self.session.execute(
            text("""
                SELECT date_trunc('day', created_at)::date AS day, count(*) AS cnt
                FROM messages
                WHERE message_type = 'system'
                  AND extra->>'action' = 'call_log'
                  AND created_at >= :cutoff
                GROUP BY day ORDER BY day
            """).bindparams(cutoff=cutoff)
        )
        dates, vals = (
            zip(*[(str(r[0]), r[1]) for r in rows.all()]) if rows.rowcount else ([], [])
        )
        lookup = dict(zip(dates, vals))
        trend = [TrendPoint(date=d, value=lookup.get(d, 0)) for d in date_spine]

        return CallTrendsResponse(
            by_kind=trend,
            by_status=trend,
        )

    async def _scalar(self, stmt) -> int | float | None:
        result = await self.session.execute(stmt)
        return result.scalar()


# ── Dependency ───────────────────────────────────────────────────────────────


def _get_call_service(
    session: AsyncSession = Depends(get_session),
) -> CallMetricsService:
    return CallMetricsService(session)


# ── Endpoints ────────────────────────────────────────────────────────────────


@router.get("/metrics/calls", response_model=CallMetricsResponse)
async def get_call_metrics(
    user: User = Depends(get_admin_user),
    svc: CallMetricsService = Depends(_get_call_service),
) -> CallMetricsResponse:
    """Call analytics: totals, kind/status breakdowns, durations, top callers, daily trend."""
    return await svc.get_call_metrics()


@router.get("/metrics/calls/trends", response_model=CallTrendsResponse)
async def get_call_trends(
    days: int = Query(default=30, ge=7, le=90),
    user: User = Depends(get_admin_user),
    svc: CallMetricsService = Depends(_get_call_service),
) -> CallTrendsResponse:
    """Call time-series: calls per day by kind and by status."""
    return await svc.get_call_trends(days)
