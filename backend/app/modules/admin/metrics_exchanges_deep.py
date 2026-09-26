"""Exchange deep analytics + cohort/retention analytics."""

import uuid
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_session
from app.modules.auth.dependencies import get_admin_user
from app.modules.auth.models import User
from app.modules.exchanges.models import ExchangeRequest

# ══════════════════════════════════════════════════════════════════════════════
# SCHEMAS
# ══════════════════════════════════════════════════════════════════════════════


class ModeTrendPoint(BaseModel):
    date: str
    trade: int
    borrow: int


class BorrowerItem(BaseModel):
    user_id: uuid.UUID
    name: str
    email: str
    borrow_count: int
    return_on_time_count: int


class ExchangeDeepMetricsResponse(BaseModel):
    total_trade: int
    total_borrow: int
    trade_borrow_ratio: float
    avg_loan_duration_days: float | None
    overdue_count: int
    overdue_rate: float
    on_time_return_rate: float
    extension_request_rate: float
    extension_approval_rate: float
    avg_completion_days_trade: float | None
    avg_completion_days_borrow: float | None
    exchanges_per_mode_trend: list[ModeTrendPoint]
    top_borrowers: list[BorrowerItem]


class RetentionQuery(BaseModel):
    weeks: int = 12


class CohortRow(BaseModel):
    cohort_week: str
    total_users: int
    week_0: float
    week_1: float
    week_2: float
    week_4: float
    week_8: float
    week_12: float


class RetentionResponse(BaseModel):
    cohorts: list[CohortRow]


# ══════════════════════════════════════════════════════════════════════════════
# SERVICE
# ══════════════════════════════════════════════════════════════════════════════


class ExchangeDeepService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get_exchange_deep(self) -> ExchangeDeepMetricsResponse:
        session = self.session

        total_trade = (
            await session.scalar(
                select(func.count())
                .select_from(ExchangeRequest)
                .where(ExchangeRequest.mode == "trade")
            )
            or 0
        )
        total_borrow = (
            await session.scalar(
                select(func.count())
                .select_from(ExchangeRequest)
                .where(ExchangeRequest.mode == "borrow")
            )
            or 0
        )
        trade_borrow_ratio = total_trade / max(total_borrow, 1)

        avg_loan_duration = await session.scalar(
            select(func.avg(ExchangeRequest.loan_duration_days)).where(
                ExchangeRequest.mode == "borrow",
                ExchangeRequest.status == "completed",
                ExchangeRequest.loan_duration_days.is_not(None),
            )
        )

        overdue_count = (
            await session.scalar(
                select(func.count())
                .select_from(ExchangeRequest)
                .where(ExchangeRequest.status == "overdue")
            )
            or 0
        )
        overdue_rate = (overdue_count / max(total_borrow, 1)) * 100

        returned_on_time = (
            await session.scalar(
                select(func.count())
                .select_from(ExchangeRequest)
                .where(ExchangeRequest.returned_on_time == True)  # noqa: E712
            )
            or 0
        )
        returned_with_data = (
            await session.scalar(
                select(func.count())
                .select_from(ExchangeRequest)
                .where(ExchangeRequest.returned_on_time.is_not(None))
            )
            or 0
        )
        on_time_return_rate = (
            (returned_on_time / max(returned_with_data, 1)) * 100 if returned_with_data else 0.0
        )

        extension_requested = (
            await session.scalar(
                select(func.count())
                .select_from(ExchangeRequest)
                .where(ExchangeRequest.extension_requested_days.is_not(None))
            )
            or 0
        )
        extension_request_rate = (extension_requested / max(total_borrow, 1)) * 100

        extension_approved = (
            await session.scalar(
                select(func.count())
                .select_from(ExchangeRequest)
                .where(ExchangeRequest.extension_status == "approved")
            )
            or 0
        )
        extension_any = (
            await session.scalar(
                select(func.count())
                .select_from(ExchangeRequest)
                .where(ExchangeRequest.extension_status != "none")
            )
            or 0
        )
        extension_approval_rate = (
            (extension_approved / max(extension_any, 1)) * 100 if extension_any else 0.0
        )

        avg_completion_days_trade = await session.scalar(
            select(
                func.avg(
                    func.extract("epoch", ExchangeRequest.updated_at - ExchangeRequest.created_at)
                    / 86400
                )
            ).where(
                ExchangeRequest.mode == "trade",
                ExchangeRequest.status == "completed",
                ExchangeRequest.created_at.is_not(None),
                ExchangeRequest.updated_at.is_not(None),
            )
        )

        avg_completion_days_borrow = await session.scalar(
            select(
                func.avg(
                    func.extract("epoch", ExchangeRequest.updated_at - ExchangeRequest.created_at)
                    / 86400
                )
            ).where(
                ExchangeRequest.mode == "borrow",
                ExchangeRequest.status == "completed",
                ExchangeRequest.created_at.is_not(None),
                ExchangeRequest.updated_at.is_not(None),
            )
        )

        now = datetime.now(UTC)
        cutoff_30d = now - timedelta(days=30)
        date_spine = [(cutoff_30d + timedelta(days=i)).strftime("%Y-%m-%d") for i in range(31)]

        trade_rows = await session.execute(
            text("""
                SELECT date_trunc('day', created_at)::date AS day, count(*) AS cnt
                FROM exchange_requests
                WHERE mode = 'trade' AND created_at >= :cutoff
                GROUP BY day ORDER BY day
            """).bindparams(cutoff=cutoff_30d)
        )
        borrow_rows = await session.execute(
            text("""
                SELECT date_trunc('day', created_at)::date AS day, count(*) AS cnt
                FROM exchange_requests
                WHERE mode = 'borrow' AND created_at >= :cutoff
                GROUP BY day ORDER BY day
            """).bindparams(cutoff=cutoff_30d)
        )

        trade_lookup = {str(r[0]): r[1] for r in trade_rows.all()}
        borrow_lookup = {str(r[0]): r[1] for r in borrow_rows.all()}

        trend = [
            ModeTrendPoint(
                date=d,
                trade=trade_lookup.get(d, 0),
                borrow=borrow_lookup.get(d, 0),
            )
            for d in date_spine
        ]

        top_borrowers_rows = await session.execute(
            text("""
                SELECT
                    u.id,
                    u.name,
                    u.email,
                    count(er.id) AS borrow_count,
                    count(er.returned_on_time) FILTER (
                        WHERE er.returned_on_time = true
                    ) AS return_on_time_count
                FROM exchange_requests er
                JOIN users u ON u.id = er.requested_by
                WHERE er.mode = 'borrow'
                GROUP BY u.id, u.name, u.email
                ORDER BY borrow_count DESC
                LIMIT 10
            """)
        )
        top_borrowers = [
            BorrowerItem(
                user_id=r[0],
                name=r[1],
                email=r[2],
                borrow_count=r[3],
                return_on_time_count=r[4],
            )
            for r in top_borrowers_rows.all()
        ]

        return ExchangeDeepMetricsResponse(
            total_trade=total_trade or 0,
            total_borrow=total_borrow or 0,
            trade_borrow_ratio=round(trade_borrow_ratio, 2),
            avg_loan_duration_days=round(float(avg_loan_duration), 1)
            if avg_loan_duration
            else None,
            overdue_count=overdue_count or 0,
            overdue_rate=round(overdue_rate, 1),
            on_time_return_rate=round(on_time_return_rate, 1),
            extension_request_rate=round(extension_request_rate, 1),
            extension_approval_rate=round(extension_approval_rate, 1),
            avg_completion_days_trade=(
                round(float(avg_completion_days_trade), 1) if avg_completion_days_trade else None
            ),
            avg_completion_days_borrow=(
                round(float(avg_completion_days_borrow), 1) if avg_completion_days_borrow else None
            ),
            exchanges_per_mode_trend=trend,
            top_borrowers=top_borrowers,
        )

    async def get_retention(self, weeks: int = 12) -> RetentionResponse:
        cutoff = datetime.now(UTC) - timedelta(weeks=weeks)

        rows = await self.session.execute(
            text("""
                WITH cohort AS (
                    SELECT
                        id,
                        created_at,
                        date_trunc('week', created_at)::date AS cohort_week
                    FROM users
                    WHERE created_at >= :cutoff
                )
                SELECT
                    c.cohort_week::text,
                    COUNT(DISTINCT c.id) AS total_users,
                    COUNT(DISTINCT CASE
                        WHEN u.last_active_at >= c.cohort_week
                         AND u.last_active_at < c.cohort_week + INTERVAL '7 days'
                        THEN c.id
                    END)::float / NULLIF(COUNT(DISTINCT c.id), 0) * 100 AS week_0,
                    COUNT(DISTINCT CASE
                        WHEN u.last_active_at >= c.cohort_week + INTERVAL '7 days'
                         AND u.last_active_at < c.cohort_week + INTERVAL '14 days'
                        THEN c.id
                    END)::float / NULLIF(COUNT(DISTINCT c.id), 0) * 100 AS week_1,
                    COUNT(DISTINCT CASE
                        WHEN u.last_active_at >= c.cohort_week + INTERVAL '14 days'
                         AND u.last_active_at < c.cohort_week + INTERVAL '21 days'
                        THEN c.id
                    END)::float / NULLIF(COUNT(DISTINCT c.id), 0) * 100 AS week_2,
                    COUNT(DISTINCT CASE
                        WHEN u.last_active_at >= c.cohort_week + INTERVAL '28 days'
                         AND u.last_active_at < c.cohort_week + INTERVAL '35 days'
                        THEN c.id
                    END)::float / NULLIF(COUNT(DISTINCT c.id), 0) * 100 AS week_4,
                    COUNT(DISTINCT CASE
                        WHEN u.last_active_at >= c.cohort_week + INTERVAL '56 days'
                         AND u.last_active_at < c.cohort_week + INTERVAL '63 days'
                        THEN c.id
                    END)::float / NULLIF(COUNT(DISTINCT c.id), 0) * 100 AS week_8,
                    COUNT(DISTINCT CASE
                        WHEN u.last_active_at >= c.cohort_week + INTERVAL '84 days'
                         AND u.last_active_at < c.cohort_week + INTERVAL '91 days'
                        THEN c.id
                    END)::float / NULLIF(COUNT(DISTINCT c.id), 0) * 100 AS week_12
                FROM cohort c
                JOIN users u ON u.id = c.id
                GROUP BY c.cohort_week
                ORDER BY c.cohort_week DESC
                LIMIT :limit
            """).bindparams(cutoff=cutoff, limit=weeks)
        )

        cohorts = [
            CohortRow(
                cohort_week=str(r[0]),
                total_users=int(r[1]),
                week_0=round(float(r[2]), 1),
                week_1=round(float(r[3]), 1),
                week_2=round(float(r[4]), 1),
                week_4=round(float(r[5]), 1),
                week_8=round(float(r[6]), 1),
                week_12=round(float(r[7]), 1),
            )
            for r in rows.all()
        ]

        return RetentionResponse(cohorts=cohorts)


# ══════════════════════════════════════════════════════════════════════════════
# ROUTER
# ══════════════════════════════════════════════════════════════════════════════


router = APIRouter(prefix="/admin", tags=["admin-ext"])


def _get_deep_service(session: AsyncSession = Depends(get_session)) -> ExchangeDeepService:
    return ExchangeDeepService(session)


@router.get("/metrics/exchanges/deep", response_model=ExchangeDeepMetricsResponse)
async def get_exchange_deep(
    user: User = Depends(get_admin_user),
    service: ExchangeDeepService = Depends(_get_deep_service),
) -> ExchangeDeepMetricsResponse:
    """Exchange deep analytics: trade/borrow breakdown, loan metrics, trends, top borrowers."""
    return await service.get_exchange_deep()


@router.get("/metrics/retention", response_model=RetentionResponse)
async def get_retention(
    weeks: int = Query(default=12, ge=1, le=52),
    user: User = Depends(get_admin_user),
    service: ExchangeDeepService = Depends(_get_deep_service),
) -> RetentionResponse:
    """Cohort retention: weekly signup cohorts with week-0 through week-12 activity rates."""
    return await service.get_retention(weeks)
