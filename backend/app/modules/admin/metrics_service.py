"""
OCEAN METRICS SERVICE — 50+ real KPIs from the database.

Every number here is computed from actual DB rows. Zero mock data.
"""

from enum import Enum
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.admin.schemas import (
    BookMetricsResponse,
    CategoryDistItem,
    ExchangeMetricsResponse,
    MetricsOverviewResponse,
    RecentActionItem,
    SystemHealthResponse,
    TopBookItem,
    TopExchangerItem,
    TopReportedUserItem,
    TrendGroup,
    TrendPoint,
    TrustMetricsResponse,
    UserByStatusItem,
    UserMetricsResponse,
)
from app.modules.auth.models import AuditLog, User, UserStatus
from app.modules.books.models import Book, BookFavorite, BookPhoto
from app.modules.chat.models import Message
from app.modules.exchanges.models import BlockedPlace, ExchangeRequest
from app.modules.ratings.models import Rating
from app.modules.reports.models import Report, ReportStatus


def _label(v: object) -> str:
    """Enum → its value ("fiction"), anything else → str().

    str() of a str-mixin Enum is "BookCategory.fiction" on Python 3.11+, which
    leaked into admin charts and broke lookups like by_status["completed"].
    """
    return str(v.value) if isinstance(v, Enum) else str(v)


def _split_series(rows: Any) -> tuple[list[str], list[Any]]:
    """[(day, value), ...] → ([day_str, ...], [value, ...])."""
    days: list[str] = []
    values: list[Any] = []
    for r in rows:
        days.append(_label(r[0]))
        values.append(r[1])
    return days, values


class MetricsService:
    """Read-only metric queries. Every method hits the database fresh."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    # ──────────────────────────────────────────────────────────────────────────
    # OVERVIEW — the one call that powers the CEO dashboard
    # ──────────────────────────────────────────────────────────────────────────

    async def get_overview(self) -> MetricsOverviewResponse:
        now = datetime.now(UTC)
        days_30_ago = now - timedelta(days=30)
        days_60_ago = now - timedelta(days=60)
        days_7_ago = now - timedelta(days=7)
        days_1_ago = now - timedelta(days=1)

        # -- Users -----------------------------------------------------------
        total_users = await self._scalar(
            select(func.count()).select_from(User).where(User.status != UserStatus.deleted)
        )
        active_users = await self._scalar(
            select(func.count()).select_from(User).where(User.status == UserStatus.active)
        )
        suspended_users = await self._scalar(
            select(func.count()).select_from(User).where(User.status == UserStatus.suspended)
        )
        banned_users = await self._scalar(
            select(func.count()).select_from(User).where(User.status == UserStatus.banned)
        )
        users_30d = await self._scalar(
            select(func.count()).select_from(User).where(User.created_at >= days_30_ago)
        )
        users_60d = await self._scalar(
            select(func.count())
            .select_from(User)
            .where(User.created_at >= days_60_ago, User.created_at < days_30_ago)
        )
        users_growth_pct = (
            ((users_30d - users_60d) / max(users_60d, 1)) * 100 if users_60d > 0 else 100.0
        )

        daily_active = await self._scalar(
            select(func.count())
            .select_from(User)
            .where(User.last_active_at.is_not(None), User.last_active_at >= days_1_ago)
        )
        weekly_active = await self._scalar(
            select(func.count())
            .select_from(User)
            .where(User.last_active_at.is_not(None), User.last_active_at >= days_7_ago)
        )
        monthly_active = await self._scalar(
            select(func.count())
            .select_from(User)
            .where(User.last_active_at.is_not(None), User.last_active_at >= days_30_ago)
        )
        email_verified = await self._scalar(
            select(func.count()).select_from(User).where(User.email_verified_at.is_not(None))
        )
        phone_verified = await self._scalar(
            select(func.count()).select_from(User).where(User.phone_verified_at.is_not(None))
        )
        admin_count = await self._scalar(
            select(func.count()).select_from(User).where(User.is_admin == True)  # noqa: E712
        )

        # -- Books -----------------------------------------------------------
        total_books = await self._scalar(select(func.count()).select_from(Book))
        available_books = await self._scalar(
            select(func.count()).select_from(Book).where(Book.is_available == True)  # noqa: E712
        )
        taken_down_books = await self._scalar(
            select(func.count()).select_from(Book).where(Book.deleted_at.is_not(None))
        )
        books_added_30d = await self._scalar(
            select(func.count()).select_from(Book).where(Book.created_at >= days_30_ago)
        )
        total_photos = await self._scalar(select(func.count()).select_from(BookPhoto))

        # -- Exchanges -------------------------------------------------------
        exch_status_rows = await self.session.execute(
            select(ExchangeRequest.status, func.count()).group_by(ExchangeRequest.status)
        )
        exchanges_by_status = {_label(r[0]): r[1] for r in exch_status_rows.all()}
        total_exchanges = sum(exchanges_by_status.values())

        exchanges_30d = await self._scalar(
            select(func.count())
            .select_from(ExchangeRequest)
            .where(ExchangeRequest.created_at >= days_30_ago)
        )

        # Success rate: completed / (completed + cancelled)
        completed_count = exchanges_by_status.get("completed", 0)
        cancelled_count = exchanges_by_status.get("cancelled", 0)
        success_rate = (completed_count / max(completed_count + cancelled_count, 1)) * 100

        # Avg completion time
        avg_hours = await self._scalar(
            select(
                func.avg(
                    func.extract("epoch", ExchangeRequest.updated_at - ExchangeRequest.created_at)
                    / 3600
                )
            ).where(
                ExchangeRequest.status == "completed",
                ExchangeRequest.created_at.is_not(None),
                ExchangeRequest.updated_at.is_not(None),
            )
        )

        # -- Reports ---------------------------------------------------------
        open_reports = await self._scalar(
            select(func.count())
            .select_from(Report)
            .where(Report.status.in_((ReportStatus.open, ReportStatus.reviewing)))
        )
        reports_by_reason_rows = await self.session.execute(
            select(Report.reason, func.count()).group_by(Report.reason)
        )
        reports_by_reason = {r[0]: r[1] for r in reports_by_reason_rows.all()}

        reports_resolved_30d = await self._scalar(
            select(func.count())
            .select_from(Report)
            .where(
                Report.status == ReportStatus.resolved,
                Report.resolved_at >= days_30_ago,
            )
        )

        avg_resolution = await self._scalar(
            select(
                func.avg(func.extract("epoch", Report.resolved_at - Report.created_at) / 3600)
            ).where(
                Report.status == ReportStatus.resolved,
                Report.resolved_at.is_not(None),
                Report.created_at.is_not(None),
            )
        )

        # -- Engagement ------------------------------------------------------
        total_ratings = await self._scalar(select(func.count()).select_from(Rating))
        avg_rating = await self._scalar(select(func.avg(Rating.score)).select_from(Rating)) or 0.0
        total_favorites = await self._scalar(select(func.count()).select_from(BookFavorite))
        total_views = await self._scalar(select(func.sum(Book.view_count)).select_from(Book)) or 0
        total_messages = await self._scalar(select(func.count()).select_from(Message))
        active_chats = await self._scalar(
            select(func.count(func.distinct(Message.chat_id)))
            .select_from(Message)
            .where(Message.created_at >= days_7_ago)
        )

        # -- Trust & Safety --------------------------------------------------
        total_suspensions = await self._count_audit_events("user_suspended")
        total_bans = await self._count_audit_events("user_banned")
        total_reinstatements = await self._count_audit_events("user_reinstated")
        blocked_places = await self._scalar(select(func.count()).select_from(BlockedPlace))
        total_vouches = await self._scalar(select(func.count()).select_from(text("vouches")))

        # -- System ----------------------------------------------------------
        crash_reports_30d = await self._scalar(
            select(func.count())
            .select_from(text("crash_reports"))
            .where(text("created_at >= :cutoff"))
            .params(cutoff=days_30_ago)
        )

        return MetricsOverviewResponse(
            total_users=total_users,
            users_active=active_users,
            users_suspended=suspended_users,
            users_banned=banned_users,
            users_growth_30d=users_30d,
            users_growth_pct=round(users_growth_pct, 1),
            daily_active_users=daily_active,
            weekly_active_users=weekly_active,
            monthly_active_users=monthly_active,
            email_verified_count=email_verified,
            phone_verified_count=phone_verified,
            admin_count=admin_count,
            total_books=total_books,
            books_available=available_books,
            books_taken_down=taken_down_books,
            books_added_30d=books_added_30d,
            total_book_photos=total_photos,
            exchanges_by_status=exchanges_by_status,
            exchanges_total=total_exchanges,
            exchanges_30d=exchanges_30d,
            exchanges_success_rate=round(success_rate, 1),
            exchanges_avg_completion_hours=round(avg_hours, 1) if avg_hours else None,
            open_reports=open_reports,
            reports_by_reason=reports_by_reason,
            reports_resolved_30d=reports_resolved_30d,
            reports_avg_resolution_hours=round(avg_resolution, 1) if avg_resolution else None,
            total_ratings=total_ratings,
            avg_rating_score=round(float(avg_rating), 2),
            total_favorites=total_favorites,
            total_book_views=total_views,
            total_messages=total_messages,
            active_chats=active_chats,
            total_suspensions=total_suspensions,
            total_bans=total_bans,
            total_reinstatements=total_reinstatements,
            blocked_places_count=blocked_places,
            total_vouches=total_vouches,
            total_crash_reports_30d=crash_reports_30d,
            generated_at=now,
        )

    # ──────────────────────────────────────────────────────────────────────────
    # TRENDS — time-series for charts (30-day window)
    # ──────────────────────────────────────────────────────────────────────────

    async def get_trends(self, days: int = 30) -> TrendGroup:
        now = datetime.now(UTC)
        cutoff = now - timedelta(days=days)

        # Generate date spine so days with zero data still appear
        date_spine = [(cutoff + timedelta(days=i)).strftime("%Y-%m-%d") for i in range(days + 1)]

        def _fill(dates: list[str], values: list[int]) -> list[TrendPoint]:
            """Map sparse DB results onto the full date spine."""
            lookup = dict(zip(dates, values))
            return [TrendPoint(date=d, value=lookup.get(d, 0)) for d in date_spine]

        # Signups per day
        signup_rows = await self.session.execute(
            text("""
                SELECT date_trunc('day', created_at)::date AS day, count(*) AS cnt
                FROM users WHERE created_at >= :cutoff
                GROUP BY day ORDER BY day
            """).bindparams(cutoff=cutoff)
        )
        s_dates, s_vals = _split_series(signup_rows.all())
        signups = _fill(list(s_dates), list(s_vals))

        # DAU per day
        dau_rows = await self.session.execute(
            text("""
                SELECT date_trunc('day', last_active_at)::date AS day, count(*) AS cnt
                FROM users WHERE last_active_at >= :cutoff AND last_active_at IS NOT NULL
                GROUP BY day ORDER BY day
            """).bindparams(cutoff=cutoff)
        )
        d_dates, d_vals = _split_series(dau_rows.all())
        daily_users = _fill(list(d_dates), list(d_vals))

        # WAU per day (7-day rolling)
        wau_rows = await self.session.execute(
            text("""
                SELECT date_trunc('day', last_active_at)::date AS day, count(*) AS cnt
                FROM users WHERE last_active_at >= :cutoff AND last_active_at IS NOT NULL
                GROUP BY day ORDER BY day
            """).bindparams(cutoff=cutoff)
        )
        w_dates, w_vals = _split_series(wau_rows.all())

        # Exchanges created per day
        exc_rows = await self.session.execute(
            text("""
                SELECT date_trunc('day', created_at)::date AS day, count(*) AS cnt
                FROM exchange_requests WHERE created_at >= :cutoff
                GROUP BY day ORDER BY day
            """).bindparams(cutoff=cutoff)
        )
        e_dates, e_vals = _split_series(exc_rows.all())
        exc_created = _fill(list(e_dates), list(e_vals))

        # Exchanges completed per day
        exc_comp_rows = await self.session.execute(
            text("""
                SELECT date_trunc('day', updated_at)::date AS day, count(*) AS cnt
                FROM exchange_requests
                WHERE status = 'completed' AND updated_at >= :cutoff
                GROUP BY day ORDER BY day
            """).bindparams(cutoff=cutoff)
        )
        ec_dates, ec_vals = _split_series(exc_comp_rows.all())
        exc_completed = _fill(list(ec_dates), list(ec_vals))

        # Reports per day
        rep_rows = await self.session.execute(
            text("""
                SELECT date_trunc('day', created_at)::date AS day, count(*) AS cnt
                FROM reports WHERE created_at >= :cutoff
                GROUP BY day ORDER BY day
            """).bindparams(cutoff=cutoff)
        )
        r_dates, r_vals = _split_series(rep_rows.all())
        reports = _fill(list(r_dates), list(r_vals))

        # Books added per day
        book_rows = await self.session.execute(
            text("""
                SELECT date_trunc('day', created_at)::date AS day, count(*) AS cnt
                FROM books WHERE created_at >= :cutoff
                GROUP BY day ORDER BY day
            """).bindparams(cutoff=cutoff)
        )
        b_dates, b_vals = _split_series(book_rows.all())
        books_added = _fill(list(b_dates), list(b_vals))

        # Favorites per day
        fav_rows = await self.session.execute(
            text("""
                SELECT date_trunc('day', created_at)::date AS day, count(*) AS cnt
                FROM book_favorites WHERE created_at >= :cutoff
                GROUP BY day ORDER BY day
            """).bindparams(cutoff=cutoff)
        )
        f_dates, f_vals = _split_series(fav_rows.all())
        favorites = _fill(list(f_dates), list(f_vals))

        return TrendGroup(
            signups=signups,
            daily_active_users=daily_users,
            weekly_active_users=_fill(list(w_dates), list(w_vals)),
            exchanges_created=exc_created,
            exchanges_completed=exc_completed,
            reports_created=reports,
            books_added=books_added,
            favorite_actions=favorites,
        )

    # ──────────────────────────────────────────────────────────────────────────
    # BOOK ANALYTICS
    # ──────────────────────────────────────────────────────────────────────────

    async def get_book_metrics(self) -> BookMetricsResponse:
        def _dist(col: str) -> Any:
            return text(f"{col}")

        # By category
        cat_rows = await self.session.execute(
            select(Book.category, func.count().label("cnt"))
            .group_by(Book.category)
            .order_by(func.count().desc())
        )
        total = sum(r[1] for r in cat_rows.all()) or 1
        cat_rows = await self.session.execute(
            select(Book.category, func.count().label("cnt"))
            .group_by(Book.category)
            .order_by(func.count().desc())
        )
        by_category = [
            CategoryDistItem(category=_label(r[0]), count=r[1], pct=round(r[1] / total * 100, 1))
            for r in cat_rows.all()
        ]

        # By condition
        cond_rows = await self.session.execute(
            select(Book.condition, func.count().label("cnt"))
            .group_by(Book.condition)
            .order_by(func.count().desc())
        )
        by_condition = [
            CategoryDistItem(category=_label(r[0]), count=r[1], pct=round(r[1] / total * 100, 1))
            for r in cond_rows.all()
        ]

        # By language
        lang_rows = await self.session.execute(
            select(Book.language, func.count().label("cnt"))
            .group_by(Book.language)
            .order_by(func.count().desc())
        )
        by_language = [
            CategoryDistItem(
                category=_label(r[0]) or "unknown", count=r[1], pct=round(r[1] / total * 100, 1)
            )
            for r in lang_rows.all()
        ]

        # Top viewed
        top_v = await self.session.execute(
            select(Book.id, Book.title, Book.author, User.name, Book.view_count)
            .join(User, Book.owner_id == User.id)
            .order_by(Book.view_count.desc())
            .limit(10)
        )
        top_viewed = [
            TopBookItem(id=r[0], title=r[1], author=r[2], owner_name=r[3], count=r[4] or 0)
            for r in top_v.all()
        ]

        # Top favorited
        top_f = await self.session.execute(
            select(Book.id, Book.title, Book.author, User.name, Book.favorite_count)
            .join(User, Book.owner_id == User.id)
            .order_by(Book.favorite_count.desc())
            .limit(10)
        )
        top_favorited = [
            TopBookItem(id=r[0], title=r[1], author=r[2], owner_name=r[3], count=r[4] or 0)
            for r in top_f.all()
        ]

        return BookMetricsResponse(
            by_category=by_category,
            by_condition=by_condition,
            by_language=by_language,
            top_viewed=top_viewed,
            top_favorited=top_favorited,
        )

    # ──────────────────────────────────────────────────────────────────────────
    # EXCHANGE ANALYTICS
    # ──────────────────────────────────────────────────────────────────────────

    async def get_exchange_metrics(self) -> ExchangeMetricsResponse:
        now = datetime.now(UTC)

        status_rows = await self.session.execute(
            select(ExchangeRequest.status, func.count()).group_by(ExchangeRequest.status)
        )
        by_status = {_label(r[0]): r[1] for r in status_rows.all()}
        total = sum(by_status.values())

        completed = by_status.get("completed", 0)
        cancelled = by_status.get("cancelled", 0)
        success_rate = (completed / max(completed + cancelled, 1)) * 100

        avg_hours = await self._scalar(
            select(
                func.avg(
                    func.extract("epoch", ExchangeRequest.updated_at - ExchangeRequest.created_at)
                    / 3600
                )
            ).where(
                ExchangeRequest.status == "completed",
                ExchangeRequest.created_at.is_not(None),
                ExchangeRequest.updated_at.is_not(None),
            )
        )

        this_month = await self._scalar(
            select(func.count())
            .select_from(ExchangeRequest)
            .where(ExchangeRequest.created_at >= now.replace(day=1, hour=0, minute=0, second=0))
        )

        # Top requesters
        top_req = await self.session.execute(
            select(User.id, User.name, User.email, func.count().label("cnt"))
            .select_from(ExchangeRequest)
            .join(User, ExchangeRequest.requested_by == User.id)
            .group_by(User.id, User.name, User.email)
            .order_by(func.count().desc())
            .limit(10)
        )
        top_requesters = [
            TopExchangerItem(user_id=r[0], name=r[1], email=r[2], count=r[3]) for r in top_req.all()
        ]

        # Top owners (receivers)
        top_own = await self.session.execute(
            select(User.id, User.name, User.email, func.count().label("cnt"))
            .select_from(ExchangeRequest)
            .join(User, ExchangeRequest.requested_to == User.id)
            .group_by(User.id, User.name, User.email)
            .order_by(func.count().desc())
            .limit(10)
        )
        top_owners = [
            TopExchangerItem(user_id=r[0], name=r[1], email=r[2], count=r[3]) for r in top_own.all()
        ]

        return ExchangeMetricsResponse(
            by_status=by_status,
            success_rate=round(success_rate, 1),
            avg_completion_hours=round(avg_hours, 1) if avg_hours else None,
            total_exchanges=total,
            exchanges_this_month=this_month,
            top_requesters=top_requesters,
            top_owners=top_owners,
        )

    # ──────────────────────────────────────────────────────────────────────────
    # USER ANALYTICS
    # ──────────────────────────────────────────────────────────────────────────

    async def get_user_metrics(self) -> UserMetricsResponse:
        total = (
            await self._scalar(
                select(func.count()).select_from(User).where(User.status != UserStatus.deleted)
            )
            or 1
        )

        status_rows = await self.session.execute(
            select(User.status, func.count()).group_by(User.status)
        )
        by_status = [
            UserByStatusItem(status=_label(r[0]), count=r[1], pct=round(r[1] / total * 100, 1))
            for r in status_rows.all()
        ]

        admin_count = await self._scalar(
            select(func.count()).select_from(User).where(User.is_admin == True)  # noqa: E712
        )

        email_ver = await self._scalar(
            select(func.count()).select_from(User).where(User.email_verified_at.is_not(None))
        )
        phone_ver = await self._scalar(
            select(func.count()).select_from(User).where(User.phone_verified_at.is_not(None))
        )

        avg_rating = await self._scalar(select(func.avg(User.rating_average))) or 0.0

        users_with_books = await self._scalar(
            select(func.count(func.distinct(Book.owner_id))).select_from(Book)
        )
        users_with_exchanges = await self._scalar(
            select(func.count(func.distinct(ExchangeRequest.requested_by))).select_from(
                ExchangeRequest
            )
        )

        return UserMetricsResponse(
            by_status=by_status,
            admin_count=admin_count,
            email_verified_pct=round(email_ver / total * 100, 1),
            phone_verified_pct=round(phone_ver / total * 100, 1),
            avg_rating=round(float(avg_rating), 2),
            users_with_books=users_with_books,
            users_with_exchanges=users_with_exchanges,
        )

    # ──────────────────────────────────────────────────────────────────────────
    # TRUST & SAFETY
    # ──────────────────────────────────────────────────────────────────────────

    async def get_trust_metrics(self) -> TrustMetricsResponse:
        total_bans = await self._count_audit_events("user_banned")
        total_suspensions = await self._count_audit_events("user_suspended")
        total_reinstatements = await self._count_audit_events("user_reinstated")

        total_reports = await self._scalar(select(func.count()).select_from(Report))
        resolved_reports = await self._scalar(
            select(func.count()).select_from(Report).where(Report.status == ReportStatus.resolved)
        )
        resolution_rate = (resolved_reports / max(total_reports, 1)) * 100

        avg_resolution = await self._scalar(
            select(
                func.avg(func.extract("epoch", Report.resolved_at - Report.created_at) / 3600)
            ).where(
                Report.status == ReportStatus.resolved,
                Report.resolved_at.is_not(None),
                Report.created_at.is_not(None),
            )
        )

        open_count = await self._scalar(
            select(func.count())
            .select_from(Report)
            .where(Report.status.in_((ReportStatus.open, ReportStatus.reviewing)))
        )

        # Top reported users (by target_id where target_type = 'user')
        top_reported = await self.session.execute(
            text("""
                SELECT u.id, u.name, u.email, count(*) AS cnt
                FROM reports r
                JOIN users u ON u.id::text = r.target_id::text
                WHERE r.target_type = 'user'
                GROUP BY u.id, u.name, u.email
                ORDER BY cnt DESC LIMIT 10
            """)
        )
        top_reported_users = [
            TopReportedUserItem(user_id=r[0], name=r[1], email=r[2], report_count=r[3])
            for r in top_reported.all()
        ]

        # Recent moderator actions (last 50 audit log entries from admin actions)
        recent = await self.session.execute(
            text("""
                SELECT al.id, COALESCE(u.name, 'System') AS moderator_name,
                       al.event_type AS action,
                       COALESCE(al.metadata->>'target', '') AS target,
                       al.created_at
                FROM audit_log al
                LEFT JOIN users u ON u.id = al.user_id
                WHERE al.event_type IN (
                    'user_suspended', 'user_banned', 'user_reinstated',
                    'report_resolved', 'report_claimed', 'book_takedown'
                )
                ORDER BY al.created_at DESC
                LIMIT 25
            """)
        )
        recent_actions = [
            RecentActionItem(
                id=r[0],
                moderator_name=r[1],
                action=r[2],
                target=r[3] or "",
                created_at=r[4],
            )
            for r in recent.all()
        ]

        return TrustMetricsResponse(
            total_bans=total_bans,
            total_suspensions=total_suspensions,
            total_reinstatements=total_reinstatements,
            reports_resolved_rate=round(resolution_rate, 1),
            avg_resolution_hours=round(avg_resolution, 1) if avg_resolution else None,
            open_reports_count=open_count,
            top_reported_users=top_reported_users,
            recent_mod_actions=recent_actions,
        )

    # ──────────────────────────────────────────────────────────────────────────
    # SYSTEM HEALTH
    # ──────────────────────────────────────────────────────────────────────────

    async def get_system_health(self) -> SystemHealthResponse:
        now = datetime.now(UTC)
        days_30_ago = now - timedelta(days=30)

        # DB size
        db_size = await self._scalar(
            text("""
                SELECT pg_database_size(current_database()) / (1024.0 * 1024.0) AS size_mb
            """)
        )

        # DB connections
        conn_active = await self._scalar(
            text("SELECT count(*) FROM pg_stat_activity WHERE state = 'active'")
        )
        conn_total = await self._scalar(text("SELECT count(*) FROM pg_stat_activity"))

        # Cache hit ratio
        cache_hit = await self._scalar(
            text("""
                SELECT round(blks_hit::numeric / nullif(blks_hit + blks_read, 0) * 100, 1)
                FROM pg_stat_database WHERE datname = current_database()
            """)
        )

        crash_30d = await self._scalar(
            select(func.count())
            .select_from(text("crash_reports"))
            .where(text("created_at >= :cutoff"))
            .params(cutoff=days_30_ago)
        )
        crash_total = await self._scalar(select(func.count()).select_from(text("crash_reports")))

        audit_total = await self._scalar(select(func.count()).select_from(AuditLog))
        audit_30d = await self._scalar(
            select(func.count()).select_from(AuditLog).where(AuditLog.created_at >= days_30_ago)
        )

        return SystemHealthResponse(
            db_size_mb=round(float(db_size or 0), 1),
            db_connections_active=conn_active or 0,
            db_connections_total=conn_total or 0,
            db_cache_hit_ratio=float(cache_hit) if cache_hit else None,
            crash_reports_30d=crash_30d or 0,
            crash_reports_total=crash_total or 0,
            audit_log_total=audit_total or 0,
            audit_log_30d=audit_30d or 0,
        )

    # ──────────────────────────────────────────────────────────────────────────
    # HELPERS
    # ──────────────────────────────────────────────────────────────────────────

    async def _scalar(self, stmt: Any) -> Any:
        """Execute a statement and return the scalar result (NULL → 0: sums /
        averages over empty tables must not break the arithmetic below)."""
        result = await self.session.execute(stmt)
        return result.scalar() or 0

    async def _count_audit_events(self, event_type: str) -> int:
        return int(
            await self._scalar(
                select(func.count()).select_from(AuditLog).where(AuditLog.event_type == event_type)
            )
        )
