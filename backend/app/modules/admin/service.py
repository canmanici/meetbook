"""Admin business logic — moderation queue, user/book actions, blocked places, metrics."""

import uuid
from decimal import Decimal
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.admin.repository import AdminRepository
from app.modules.admin.schemas import (
    AdminBookDetailView,
    AdminBookListItem,
    AdminExchangeListItem,
    AdminUserListItem,
    AdminBookListResponse,
    AdminExchangeDetailView,
    AdminExchangeListResponse,
    AdminReportListResponse,
    AdminReportView,
    AdminUserDetailView,
    AdminUserListResponse,
    AdminUserView,
    AuditLogEntry,
    AuditLogListResponse,
    BlockedPlaceCreateRequest,
    BlockedPlaceListResponse,
    BlockedPlaceView,
    MetricsResponse,
    ReportResolveRequest,
)
from app.modules.auth.models import AuditLog, User, UserStatus
from app.modules.books.models import Book
from app.modules.crash_reports.models import CrashReport, CrashReportGroup
from app.modules.exchanges.models import BlockedPlace, ExchangeRequest, ExchangeStatus
from app.modules.notifications.service import NotificationService
from app.modules.reports.models import Report, ReportStatus


class AdminError(Exception):
    def __init__(self, code: str, status_code: int = 400) -> None:
        self.code = code
        self.status_code = status_code


def _report_to_view(report: Report) -> AdminReportView:
    return AdminReportView(
        id=report.id,
        reporter_id=report.reporter_id,
        target_type=report.target_type,
        target_id=report.target_id,
        reason=report.reason,
        content_snapshot=report.content_snapshot,
        status=report.status,
        moderator_id=report.moderator_id,
        moderator_notes=report.moderator_notes,
        created_at=report.created_at,
        updated_at=report.updated_at,
        resolved_at=report.resolved_at,
    )


def _blocked_place_to_view(blocked: BlockedPlace) -> BlockedPlaceView:
    return BlockedPlaceView(
        id=blocked.id,
        place_id=blocked.place_id,
        lat=blocked.lat,
        lng=blocked.lng,
        reason=blocked.reason,
        created_at=blocked.created_at,
    )


class AdminService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.repo = AdminRepository(session)
        self.notification_service = NotificationService(session)

    async def _audit(
        self, moderator_id: uuid.UUID, event_type: str, metadata: dict[str, Any]
    ) -> None:
        self.session.add(AuditLog(user_id=moderator_id, event_type=event_type, metadata_=metadata))

    # -- Reports ---------------------------------------------------------------

    async def list_reports(self, status: ReportStatus | None) -> AdminReportListResponse:
        reports = await self.repo.list_reports(status)
        return AdminReportListResponse(items=[_report_to_view(r) for r in reports])

    async def get_report(self, report_id: uuid.UUID) -> AdminReportView:
        report = await self.repo.get_report(report_id)
        if report is None:
            raise AdminError("NOT_FOUND", 404)
        return _report_to_view(report)

    async def claim_report(self, report_id: uuid.UUID, moderator_id: uuid.UUID) -> AdminReportView:
        report = await self.repo.get_report(report_id)
        if report is None:
            raise AdminError("NOT_FOUND", 404)

        if report.status in (ReportStatus.resolved, ReportStatus.dismissed):
            raise AdminError("ALREADY_RESOLVED", 409)

        report.status = ReportStatus.reviewing
        report.moderator_id = moderator_id
        report.updated_at = datetime.now(UTC)
        await self._audit(moderator_id, "report_claimed", {"report_id": str(report_id)})
        await self.session.commit()
        return _report_to_view(report)

    async def resolve_report(
        self, report_id: uuid.UUID, moderator_id: uuid.UUID, body: ReportResolveRequest
    ) -> AdminReportView:
        if body.status not in (ReportStatus.resolved, ReportStatus.dismissed):
            raise AdminError("INVALID_STATUS", 400)

        report = await self.repo.get_report(report_id)
        if report is None:
            raise AdminError("NOT_FOUND", 404)

        if report.status in (ReportStatus.resolved, ReportStatus.dismissed):
            raise AdminError("ALREADY_RESOLVED", 409)

        report.status = body.status
        report.moderator_id = moderator_id
        report.moderator_notes = body.moderator_notes
        report.resolved_at = datetime.now(UTC)
        report.updated_at = report.resolved_at

        await self.notification_service.create_notification(
            user_id=report.reporter_id,
            type_="report_resolved",
            payload={
                "report_id": str(report.id),
                "status": body.status.value,
                "moderator_notes": body.moderator_notes,
            },
        )
        await self._audit(
            moderator_id,
            "report_resolved",
            {"report_id": str(report_id), "status": body.status.value},
        )
        await self.session.commit()
        return _report_to_view(report)

    # -- Users -----------------------------------------------------------------

    async def suspend_user(
        self, user_id: uuid.UUID, moderator_id: uuid.UUID, reason: str | None
    ) -> AdminUserView:
        if user_id == moderator_id:
            # Locking yourself out of the admin panel is never intended.
            raise AdminError("CANNOT_MODERATE_SELF", 409)
        user = await self.repo.get_user(user_id)
        if user is None:
            raise AdminError("NOT_FOUND", 404)

        user.status = UserStatus.suspended
        user.updated_at = datetime.now(UTC)
        await self._audit(
            moderator_id, "user_suspended", {"user_id": str(user_id), "reason": reason}
        )
        await self.session.commit()
        return _user_to_view(user)

    async def reinstate_user(self, user_id: uuid.UUID, moderator_id: uuid.UUID) -> AdminUserView:
        user = await self.repo.get_user(user_id)
        if user is None:
            raise AdminError("NOT_FOUND", 404)

        user.status = UserStatus.active
        user.updated_at = datetime.now(UTC)
        await self._audit(moderator_id, "user_reinstated", {"user_id": str(user_id)})
        await self.session.commit()
        return _user_to_view(user)

    async def ban_user(
        self, user_id: uuid.UUID, moderator_id: uuid.UUID, reason: str | None
    ) -> AdminUserView:
        if user_id == moderator_id:
            # Locking yourself out of the admin panel is never intended.
            raise AdminError("CANNOT_MODERATE_SELF", 409)
        user = await self.repo.get_user(user_id)
        if user is None:
            raise AdminError("NOT_FOUND", 404)
        user.status = UserStatus.banned
        user.updated_at = datetime.now(UTC)
        await self._audit(moderator_id, "user_banned", {"user_id": str(user_id), "reason": reason})
        await self.session.commit()
        return _user_to_view(user)

    async def unban_user(self, user_id: uuid.UUID, moderator_id: uuid.UUID) -> AdminUserView:
        user = await self.repo.get_user(user_id)
        if user is None:
            raise AdminError("NOT_FOUND", 404)
        user.status = UserStatus.active
        user.updated_at = datetime.now(UTC)
        await self._audit(moderator_id, "user_unbanned", {"user_id": str(user_id)})
        await self.session.commit()
        return _user_to_view(user)

    async def set_trust_score(
        self, user_id: uuid.UUID, moderator_id: uuid.UUID, score: float | None, reason: str | None
    ) -> AdminUserDetailView:
        user = await self.repo.get_user(user_id)
        if user is None:
            raise AdminError("NOT_FOUND", 404)
        user.trust_score_override = Decimal(str(score)) if score is not None else None
        user.updated_at = datetime.now(UTC)
        await self._audit(
            moderator_id,
            "user_trust_score_changed",
            {"user_id": str(user_id), "score": score, "reason": reason},
        )
        await self.session.commit()
        detail = await self.repo.get_user_detail(user_id)
        if detail is None:
            raise AdminError("NOT_FOUND", 404)
        return _user_to_detail_view(detail)

    async def broadcast_notification(
        self, moderator_id: uuid.UUID, title: str, message: str
    ) -> int:
        user_ids = await self.repo.list_active_user_ids()
        count = await self.notification_service.broadcast(
            user_ids, "admin_broadcast", {"title": title, "message": message}
        )
        await self._audit(
            moderator_id,
            "notification_broadcast",
            {"recipients": count, "title": title},
        )
        await self.session.commit()
        return count

    # -- Books -----------------------------------------------------------------

    async def takedown_book(
        self, book_id: uuid.UUID, moderator_id: uuid.UUID, reason: str | None
    ) -> None:
        book = await self.repo.get_book(book_id)
        if book is None:
            raise AdminError("NOT_FOUND", 404)

        book.is_available = False
        book.deleted_at = datetime.now(UTC)
        book.updated_at = book.deleted_at
        await self._audit(
            moderator_id, "book_takedown", {"book_id": str(book_id), "reason": reason}
        )
        await self.session.commit()

    # -- Blocked places ----------------------------------------------------------

    async def list_blocked_places(self) -> BlockedPlaceListResponse:
        places = await self.repo.list_blocked_places()
        return BlockedPlaceListResponse(items=[_blocked_place_to_view(p) for p in places])

    async def create_blocked_place(
        self, moderator_id: uuid.UUID, body: BlockedPlaceCreateRequest
    ) -> BlockedPlaceView:
        blocked = await self.repo.create_blocked_place(
            lat=body.lat, lng=body.lng, place_id=body.place_id, reason=body.reason
        )
        await self._audit(
            moderator_id,
            "blocked_place_created",
            {"lat": body.lat, "lng": body.lng, "reason": body.reason},
        )
        await self.session.commit()
        return _blocked_place_to_view(blocked)

    async def delete_blocked_place(
        self, moderator_id: uuid.UUID, blocked_place_id: uuid.UUID
    ) -> None:
        blocked = await self.repo.get_blocked_place(blocked_place_id)
        if blocked is None:
            raise AdminError("NOT_FOUND", 404)

        await self.repo.delete_blocked_place(blocked)
        await self._audit(
            moderator_id, "blocked_place_deleted", {"blocked_place_id": str(blocked_place_id)}
        )
        await self.session.commit()

    # -- Metrics -------------------------------------------------------------------

    async def get_metrics(self) -> MetricsResponse:
        return MetricsResponse(
            daily_active_users=await self.repo.count_daily_active_users(),
            total_users=await self.repo.count_total_users(),
            exchanges_by_status=await self.repo.exchanges_by_status(),
            reports_by_reason=await self.repo.reports_by_reason(),
            open_reports=await self.repo.count_open_reports(),
        )

    # -- Users list/detail ------------------------------------------------------

    async def list_users(
        self,
        search: str | None = None,
        status: UserStatus | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> AdminUserListResponse:
        users_with_counts, total = await self.repo.list_users(search, status, limit, offset)
        return AdminUserListResponse(
            items=[_user_to_list_item(u, bc, mc, ec) for u, bc, mc, ec in users_with_counts],
            total=total,
        )

    async def get_user_detail(self, user_id: uuid.UUID) -> AdminUserDetailView:
        user = await self.repo.get_user_detail(user_id)
        if user is None:
            raise AdminError("NOT_FOUND", 404)
        return _user_to_detail_view(user)

    # -- Books list/detail ------------------------------------------------------

    async def list_books(
        self,
        search: str | None = None,
        available_only: bool = False,
        limit: int = 50,
        offset: int = 0,
    ) -> AdminBookListResponse:
        books, total = await self.repo.list_books(search, available_only, limit, offset)
        return AdminBookListResponse(
            items=[_book_to_list_item(b) for b in books],
            total=total,
        )

    async def get_book_detail(self, book_id: uuid.UUID) -> AdminBookDetailView:
        book = await self.repo.get_book_detail(book_id)
        if book is None:
            raise AdminError("NOT_FOUND", 404)
        return _book_to_detail_view(book)

    # -- Exchanges list/detail --------------------------------------------------

    async def list_exchanges(
        self, status: ExchangeStatus | None = None, limit: int = 50, offset: int = 0
    ) -> AdminExchangeListResponse:
        exchanges, total = await self.repo.list_exchanges(status, limit, offset)
        return AdminExchangeListResponse(
            items=[_exchange_to_list_item(e) for e in exchanges],
            total=total,
        )

    async def get_exchange_detail(self, exchange_id: uuid.UUID) -> AdminExchangeDetailView:
        exchange = await self.repo.get_exchange_detail(exchange_id)
        if exchange is None:
            raise AdminError("NOT_FOUND", 404)
        return _exchange_to_detail_view(exchange)

    # -- Audit log --------------------------------------------------------------

    async def list_audit_logs(
        self,
        user_id: uuid.UUID | None = None,
        event_type: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> AuditLogListResponse:
        rows, total = await self.repo.list_audit_logs(user_id, event_type, limit, offset)
        return AuditLogListResponse(
            items=[_audit_to_view(l, name, email) for l, name, email in rows],
            total=total,
        )

    async def global_search(self, q: str) -> dict[str, Any]:
        """Quick global search across users, books, and exchanges."""
        users: list[dict[str, Any]] = []
        books: list[dict[str, Any]] = []
        exchanges: list[dict[str, Any]] = []
        if len(q) < 2:
            return {"users": users, "books": books, "exchanges": exchanges}
        # Users: by email or name
        stmt_users = (
            select(User)
            .where(
                or_(
                    User.email.ilike(f"%{q}%"),
                    User.name.ilike(f"%{q}%"),
                )
            )
            .limit(10)
        )
        for row in await self.session.execute(stmt_users):
            u = row[0]
            users.append(
                {"id": str(u.id), "email": u.email, "name": u.name, "status": u.status.value}
            )
        # Books: by title or author
        stmt_books = (
            select(Book)
            .where(
                or_(
                    Book.title.ilike(f"%{q}%"),
                    Book.author.ilike(f"%{q}%"),
                )
            )
            .limit(10)
        )
        for book_row in await self.session.execute(stmt_books):
            b = book_row[0]
            books.append({"id": str(b.id), "title": b.title, "author": b.author})
        # Exchanges: by ID
        try:
            uid = uuid.UUID(q) if len(q) >= 32 else None
            if uid:
                stmt_exc = select(ExchangeRequest).where(ExchangeRequest.id == uid).limit(5)
                for exc_row in await self.session.execute(stmt_exc):
                    e = exc_row[0]
                    exchanges.append({"id": str(e.id), "status": e.status.value})
        except ValueError, AttributeError:
            pass
        return {"users": users, "books": books, "exchanges": exchanges}

    async def get_badges(self) -> dict[str, Any]:
        """Badge counts for the admin navbar polling endpoint."""
        # New crash report groups (status='new')
        result = await self.session.execute(
            select(func.count(CrashReportGroup.id)).where(CrashReportGroup.status == "new")
        )
        new_crashes = result.scalar() or 0

        # Open user reports (status='open')
        result = await self.session.execute(
            select(func.count(Report.id)).where(Report.status == ReportStatus.open)
        )
        open_reports = result.scalar() or 0

        # Recent audit log entries (last 24h)
        since = datetime.now(UTC) - timedelta(hours=24)
        result = await self.session.execute(
            select(func.count(AuditLog.id)).where(AuditLog.created_at >= since)
        )
        recent_audit = result.scalar() or 0

        # Total crash reports
        result = await self.session.execute(select(func.count(CrashReport.id)))
        total_crashes = result.scalar() or 0

        return {
            "new_crashes": new_crashes,
            "open_reports": open_reports,
            "recent_audit": recent_audit,
            "total_crashes": total_crashes,
        }


def _user_to_view(user: User) -> AdminUserView:
    return AdminUserView(
        id=user.id,
        email=user.email,
        name=user.name,
        status=user.status.value,
        rating_average=float(user.rating_average),
        rating_count=user.rating_count,
        completed_exchanges=user.completed_exchanges,
        created_at=user.created_at,
    )


def _user_to_list_item(
    user: User, book_count: int = 0, message_count: int = 0, exchange_count: int = 0
) -> AdminUserListItem:
    return AdminUserListItem(
        id=user.id,
        email=user.email,
        name=user.name,
        status=user.status.value,
        is_admin=user.is_admin,
        rating_average=float(user.rating_average),
        rating_count=user.rating_count,
        completed_exchanges=user.completed_exchanges,
        created_at=user.created_at,
        last_active_at=user.last_active_at,
        book_count=book_count,
        message_count=message_count,
        exchange_count=exchange_count,
    )


def _user_to_detail_view(user: User) -> AdminUserDetailView:
    from app.modules.admin.schemas import AdminUserDetailView
    from app.modules.auth.trust import compute_trust

    trust = compute_trust(
        rating_average=float(user.rating_average or 0),
        loans_borrowed_count=user.loans_borrowed_count,
        loans_returned_on_time=user.loans_returned_on_time,
        loans_returned_late=user.loans_returned_late,
        trust_score_override=(
            float(user.trust_score_override) if user.trust_score_override is not None else None
        ),
    )
    return AdminUserDetailView(
        loans_borrowed_count=user.loans_borrowed_count,
        loans_returned_on_time=user.loans_returned_on_time,
        loans_returned_late=user.loans_returned_late,
        trust_score_override=(
            float(user.trust_score_override) if user.trust_score_override is not None else None
        ),
        trust_score=trust.score,
        id=user.id,
        email=user.email,
        name=user.name,
        phone=user.phone,
        status=user.status.value,
        is_admin=user.is_admin,
        rating_average=float(user.rating_average),
        rating_count=user.rating_count,
        completed_exchanges=user.completed_exchanges,
        created_at=user.created_at,
        updated_at=user.updated_at,
        last_active_at=user.last_active_at,
        email_verified_at=user.email_verified_at,
        phone_verified_at=user.phone_verified_at,
        trusted_contact_name=user.trusted_contact_name,
        trusted_contact_phone=user.trusted_contact_phone,
    )


def _book_to_list_item(book: Book) -> AdminBookListItem:
    return AdminBookListItem(
        id=book.id,
        owner_id=book.owner_id,
        title=book.title,
        author=book.author,
        category=book.category.value,
        condition=book.condition.value,
        is_available=book.is_available,
        view_count=book.view_count,
        favorite_count=book.favorite_count,
        created_at=book.created_at,
    )


def _book_to_detail_view(book: Book) -> AdminBookDetailView:
    from app.modules.admin.schemas import AdminBookDetailView

    return AdminBookDetailView(
        id=book.id,
        owner_id=book.owner_id,
        title=book.title,
        author=book.author,
        isbn=book.isbn,
        description=book.description,
        category=book.category.value,
        language=book.language,
        condition=book.condition.value,
        is_available=book.is_available,
        view_count=book.view_count,
        favorite_count=book.favorite_count,
        created_at=book.created_at,
        updated_at=book.updated_at,
        deleted_at=book.deleted_at,
    )


def _exchange_to_list_item(exchange: ExchangeRequest) -> AdminExchangeListItem:
    return AdminExchangeListItem(
        id=exchange.id,
        book_id=exchange.book_id,
        requested_by=exchange.requested_by,
        requested_to=exchange.requested_to,
        status=exchange.status.value,
        created_at=exchange.created_at,
        updated_at=exchange.updated_at,
        expires_at=exchange.expires_at,
    )


def _exchange_to_detail_view(exchange: ExchangeRequest) -> AdminExchangeDetailView:
    from app.modules.admin.schemas import AdminExchangeDetailView

    return AdminExchangeDetailView(
        id=exchange.id,
        book_id=exchange.book_id,
        requested_by=exchange.requested_by,
        requested_to=exchange.requested_to,
        status=exchange.status.value,
        initial_message=exchange.initial_message,
        completion_marked_by=exchange.completion_marked_by,
        created_at=exchange.created_at,
        updated_at=exchange.updated_at,
        expires_at=exchange.expires_at,
    )


def _audit_to_view(
    log: AuditLog, user_name: str | None = None, user_email: str | None = None
) -> AuditLogEntry:
    return AuditLogEntry(
        id=log.id,
        user_id=log.user_id,
        user_name=user_name,
        user_email=user_email,
        event_type=log.event_type,
        ip_address=str(log.ip_address) if log.ip_address else None,
        user_agent=log.user_agent,
        metadata_=log.metadata_,
        created_at=log.created_at,
    )
