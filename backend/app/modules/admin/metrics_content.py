"""Book view metrics, search terms analytics, and deep report analytics."""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_session
from app.modules.auth.dependencies import get_admin_user
from app.modules.auth.models import AuditLog, User
from app.modules.books.models import Book
from app.modules.reports.models import Report, ReportStatus

router = APIRouter(prefix="/admin", tags=["admin-ext"])


# ══════════════════════════════════════════════════════════════════════════════
# SCHEMAS — Book View Metrics
# ══════════════════════════════════════════════════════════════════════════════


class TopBookViewItem(BaseModel):
    id: uuid.UUID
    title: str
    author: str | None
    owner_name: str
    view_count: int


class ViewDistItem(BaseModel):
    range: str
    count: int


class BookViewMetricsResponse(BaseModel):
    total_views: int
    avg_views_per_book: float
    books_with_views: int
    books_with_zero_views: int
    top_viewed_books: list[TopBookViewItem]
    view_count_distribution: list[ViewDistItem]


# ══════════════════════════════════════════════════════════════════════════════
# SCHEMAS — Search Metrics
# ══════════════════════════════════════════════════════════════════════════════


class SearchTermItem(BaseModel):
    term: str
    count: int


class SearchMetricsResponse(BaseModel):
    total_searches_logged: int
    searches_30d: int
    top_search_terms: list[SearchTermItem]
    searches_without_results: int | None


# ══════════════════════════════════════════════════════════════════════════════
# SCHEMAS — Report Deep Analytics
# ══════════════════════════════════════════════════════════════════════════════


class ReporterItem(BaseModel):
    user_id: uuid.UUID
    name: str
    email: str
    report_count: int


class TrendPoint(BaseModel):
    date: str
    value: int


class ReportResolvedTrendPoint(BaseModel):
    date: str
    filed: int
    resolved: int


class ReportDeepMetricsResponse(BaseModel):
    total_reports: int
    by_target_type: dict[str, int]
    by_reason: dict[str, int]
    by_status: dict[str, int]
    avg_resolution_hours: float | None
    resolution_rate: float
    top_reporters: list[ReporterItem]
    daily_report_trend: list[TrendPoint]
    reports_vs_resolved_trend: list[ReportResolvedTrendPoint]


# ══════════════════════════════════════════════════════════════════════════════
# SERVICE
# ══════════════════════════════════════════════════════════════════════════════


class ContentMetricsService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def _scalar(self, stmt: Any) -> int | float | None:
        result = await self.session.execute(stmt)
        return result.scalar()

    # ── Book View Metrics ─────────────────────────────────────────────────────

    async def get_book_view_metrics(self) -> BookViewMetricsResponse:
        session = self.session

        total_views = await session.scalar(select(func.coalesce(func.sum(Book.view_count), 0))) or 0

        avg_views = await session.scalar(select(func.avg(Book.view_count))) or 0.0

        books_with_views = (
            await session.scalar(select(func.count()).where(Book.view_count > 0)) or 0
        )

        books_zero = (
            await session.scalar(select(func.count()).where(func.coalesce(Book.view_count, 0) == 0))
            or 0
        )

        top_rows = await session.execute(
            text("""
                SELECT b.id, b.title, b.author, u.name AS owner_name, b.view_count
                FROM books b
                JOIN users u ON u.id = b.owner_id
                WHERE b.deleted_at IS NULL
                ORDER BY b.view_count DESC
                LIMIT 10
            """)
        )
        top_viewed_books = [
            TopBookViewItem(id=r[0], title=r[1], author=r[2], owner_name=r[3], view_count=r[4] or 0)
            for r in top_rows.all()
        ]

        dist_rows = await session.execute(
            text("""
                SELECT
                    CASE
                        WHEN view_count = 0 THEN '0'
                        WHEN view_count <= 10 THEN '1-10'
                        WHEN view_count <= 50 THEN '11-50'
                        WHEN view_count <= 200 THEN '51-200'
                        ELSE '201+'
                    END AS range,
                    count(*) AS cnt
                FROM books
                GROUP BY range
                ORDER BY min(view_count)
            """)
        )
        view_count_distribution = [ViewDistItem(range=r[0], count=r[1]) for r in dist_rows.all()]

        return BookViewMetricsResponse(
            total_views=int(total_views),
            avg_views_per_book=round(float(avg_views), 2),
            books_with_views=books_with_views,
            books_with_zero_views=books_zero,
            top_viewed_books=top_viewed_books,
            view_count_distribution=view_count_distribution,
        )

    # ── Search Metrics ────────────────────────────────────────────────────────

    async def get_search_metrics(self) -> SearchMetricsResponse:
        session = self.session
        now = datetime.now(UTC)
        cutoff_30d = now - timedelta(days=30)

        total_searches = (
            await session.scalar(
                select(func.count())
                .select_from(AuditLog)
                .where(AuditLog.event_type == "search_performed")
            )
            or 0
        )

        searches_30d = (
            await session.scalar(
                select(func.count())
                .select_from(AuditLog)
                .where(
                    AuditLog.event_type == "search_performed",
                    AuditLog.created_at >= cutoff_30d,
                )
            )
            or 0
        )

        term_rows = await session.execute(
            text("""
                SELECT metadata->>'query' AS term, count(*) AS cnt
                FROM audit_log
                WHERE event_type = 'search_performed'
                  AND created_at >= :cutoff
                  AND metadata->>'query' IS NOT NULL
                GROUP BY term
                ORDER BY cnt DESC
                LIMIT 20
            """).bindparams(cutoff=cutoff_30d)
        )
        top_search_terms = [SearchTermItem(term=r[0], count=r[1]) for r in term_rows.all()]

        searches_without = await session.scalar(
            text("""
                SELECT count(*)
                FROM audit_log
                WHERE event_type = 'search_performed'
                  AND metadata->>'result_count' IS NOT NULL
                  AND (metadata->>'result_count')::int = 0
                  AND created_at >= :cutoff
            """).bindparams(cutoff=cutoff_30d)
        )

        return SearchMetricsResponse(
            total_searches_logged=total_searches,
            searches_30d=searches_30d,
            top_search_terms=top_search_terms,
            searches_without_results=searches_without if searches_without else None,
        )

    # ── Report Deep Analytics ─────────────────────────────────────────────────

    async def get_report_deep_metrics(self) -> ReportDeepMetricsResponse:
        session = self.session
        now = datetime.now(UTC)
        cutoff_30d = now - timedelta(days=30)

        total_reports = await session.scalar(select(func.count()).select_from(Report)) or 0

        tt_rows = await session.execute(
            select(Report.target_type, func.count()).group_by(Report.target_type)
        )
        by_target_type = {str(r[0]): r[1] for r in tt_rows.all()}

        reason_rows = await session.execute(
            select(Report.reason, func.count())
            .group_by(Report.reason)
            .order_by(func.count().desc())
        )
        by_reason = {r[0]: r[1] for r in reason_rows.all()}

        status_rows = await session.execute(
            select(Report.status, func.count()).group_by(Report.status)
        )
        by_status = {str(r[0]): r[1] for r in status_rows.all()}

        avg_res = await session.scalar(
            select(
                func.avg(func.extract("epoch", Report.resolved_at - Report.created_at) / 3600)
            ).where(
                Report.status == ReportStatus.resolved,
                Report.resolved_at.is_not(None),
                Report.created_at.is_not(None),
            )
        )
        avg_resolution_hours = round(float(avg_res), 1) if avg_res else None

        resolved_count = by_status.get("resolved", 0)
        resolution_rate = (resolved_count / max(total_reports, 1)) * 100

        reporter_rows = await session.execute(
            text("""
                SELECT u.id, u.name, u.email, count(*) AS cnt
                FROM reports r
                JOIN users u ON u.id = r.reporter_id
                GROUP BY u.id, u.name, u.email
                ORDER BY cnt DESC
                LIMIT 10
            """)
        )
        top_reporters = [
            ReporterItem(user_id=r[0], name=r[1], email=r[2], report_count=r[3])
            for r in reporter_rows.all()
        ]

        date_spine = [(cutoff_30d + timedelta(days=i)).strftime("%Y-%m-%d") for i in range(31)]

        report_day_rows = await session.execute(
            text("""
                SELECT date_trunc('day', created_at)::date AS day, count(*) AS cnt
                FROM reports
                WHERE created_at >= :cutoff
                GROUP BY day ORDER BY day
            """).bindparams(cutoff=cutoff_30d)
        )
        report_lookup = {str(r[0]): r[1] for r in report_day_rows.all()}
        daily_report_trend = [TrendPoint(date=d, value=report_lookup.get(d, 0)) for d in date_spine]

        filed_day_rows = await session.execute(
            text("""
                SELECT date_trunc('day', created_at)::date AS day, count(*) AS cnt
                FROM reports
                WHERE created_at >= :cutoff
                GROUP BY day ORDER BY day
            """).bindparams(cutoff=cutoff_30d)
        )
        filed_lookup = {str(r[0]): r[1] for r in filed_day_rows.all()}

        resolved_day_rows = await session.execute(
            text("""
                SELECT date_trunc('day', resolved_at)::date AS day, count(*) AS cnt
                FROM reports
                WHERE resolved_at IS NOT NULL
                  AND resolved_at >= :cutoff
                GROUP BY day ORDER BY day
            """).bindparams(cutoff=cutoff_30d)
        )
        resolved_lookup = {str(r[0]): r[1] for r in resolved_day_rows.all()}

        reports_vs_resolved_trend = [
            ReportResolvedTrendPoint(
                date=d,
                filed=filed_lookup.get(d, 0),
                resolved=resolved_lookup.get(d, 0),
            )
            for d in date_spine
        ]

        return ReportDeepMetricsResponse(
            total_reports=total_reports,
            by_target_type=by_target_type,
            by_reason=by_reason,
            by_status=by_status,
            avg_resolution_hours=avg_resolution_hours,
            resolution_rate=round(resolution_rate, 1),
            top_reporters=top_reporters,
            daily_report_trend=daily_report_trend,
            reports_vs_resolved_trend=reports_vs_resolved_trend,
        )


# ══════════════════════════════════════════════════════════════════════════════
# DI
# ══════════════════════════════════════════════════════════════════════════════


def _get_content_service(
    session: AsyncSession = Depends(get_session),
) -> ContentMetricsService:
    return ContentMetricsService(session)


# ══════════════════════════════════════════════════════════════════════════════
# ENDPOINTS
# ══════════════════════════════════════════════════════════════════════════════


@router.get("/metrics/book-views", response_model=BookViewMetricsResponse)
async def get_book_view_metrics(
    user: User = Depends(get_admin_user),
    svc: ContentMetricsService = Depends(_get_content_service),
) -> BookViewMetricsResponse:
    """Book view analytics: total views, avg per book, distribution, top viewed books."""
    return await svc.get_book_view_metrics()


@router.get("/metrics/search", response_model=SearchMetricsResponse)
async def get_search_metrics(
    user: User = Depends(get_admin_user),
    svc: ContentMetricsService = Depends(_get_content_service),
) -> SearchMetricsResponse:
    """Search analytics: total searches, top terms, searches without results."""
    return await svc.get_search_metrics()


@router.get("/metrics/reports/deep", response_model=ReportDeepMetricsResponse)
async def get_report_deep_metrics(
    user: User = Depends(get_admin_user),
    svc: ContentMetricsService = Depends(_get_content_service),
) -> ReportDeepMetricsResponse:
    """Deep report analytics: breakdowns, resolution stats, trends, top reporters."""
    return await svc.get_report_deep_metrics()
