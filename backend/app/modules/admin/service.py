"""Admin business logic — moderation queue, user/book actions, blocked places, metrics."""

import uuid
from datetime import UTC, datetime

from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.admin.repository import AdminRepository
from app.modules.admin.schemas import (
    AdminReportListResponse,
    AdminReportView,
    AdminUserView,
    BlockedPlaceCreateRequest,
    BlockedPlaceListResponse,
    BlockedPlaceView,
    MetricsResponse,
    ReportResolveRequest,
)
from app.modules.auth.models import AuditLog, UserStatus
from app.modules.exchanges.models import BlockedPlace
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
        self, moderator_id: uuid.UUID, event_type: str, metadata: dict
    ) -> None:
        self.session.add(
            AuditLog(user_id=moderator_id, event_type=event_type, metadata_=metadata)
        )

    # -- Reports ---------------------------------------------------------------

    async def list_reports(self, status: ReportStatus | None) -> AdminReportListResponse:
        reports = await self.repo.list_reports(status)
        return AdminReportListResponse(items=[_report_to_view(r) for r in reports])

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

    async def suspend_user(self, user_id: uuid.UUID, moderator_id: uuid.UUID, reason: str | None) -> AdminUserView:
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

    async def delete_blocked_place(self, moderator_id: uuid.UUID, blocked_place_id: uuid.UUID) -> None:
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


def _user_to_view(user) -> AdminUserView:
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
