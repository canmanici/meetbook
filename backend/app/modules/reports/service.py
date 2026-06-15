"""Reports business logic — content snapshotting for moderation."""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.auth.repository import AuthRepository
from app.modules.books.repository import BookRepository
from app.modules.reports.models import Report, ReportTarget
from app.modules.reports.repository import ReportRepository
from app.modules.reports.schemas import ReportCreateRequest, ReportView


class ReportError(Exception):
    def __init__(self, code: str, status_code: int = 400) -> None:
        self.code = code
        self.status_code = status_code


def _to_view(report: Report) -> ReportView:
    return ReportView(
        id=report.id,
        reporter_id=report.reporter_id,
        target_type=report.target_type,
        target_id=report.target_id,
        reason=report.reason,
        status=report.status,
        created_at=report.created_at,
    )


class ReportService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.repo = ReportRepository(session)
        self.auth_repo = AuthRepository(session)
        self.books_repo = BookRepository(session)

    async def _build_snapshot(self, target_type: ReportTarget, target_id: uuid.UUID) -> dict:
        if target_type == ReportTarget.user:
            user = await self.auth_repo.get_user_by_id(target_id)
            if user is None:
                raise ReportError("TARGET_NOT_FOUND", 404)
            return {
                "id": str(user.id),
                "name": user.name,
                "email": user.email,
                "status": user.status.value,
            }

        if target_type == ReportTarget.book:
            book_row = await self.books_repo.get_by_id(target_id)
            if book_row is None:
                raise ReportError("TARGET_NOT_FOUND", 404)
            book = book_row.book
            return {
                "id": str(book.id),
                "title": book.title,
                "author": book.author,
                "description": book.description,
                "owner_id": str(book.owner_id),
                "is_available": book.is_available,
            }

        # message / place: no dedicated lookup tables yet — record the raw id
        # so moderators have the reference even if the underlying content
        # is later deleted or edited.
        return {"id": str(target_id), "target_type": target_type.value}

    async def create_report(self, reporter_id: uuid.UUID, body: ReportCreateRequest) -> ReportView:
        snapshot = await self._build_snapshot(body.target_type, body.target_id)
        report = await self.repo.create(
            reporter_id=reporter_id,
            target_type=body.target_type,
            target_id=body.target_id,
            reason=body.reason,
            content_snapshot=snapshot,
        )
        await self.session.commit()
        return _to_view(report)
