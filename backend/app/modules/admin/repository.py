"""Database queries for the admin module."""

import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.geo import make_point
from app.modules.auth.models import User, UserStatus
from app.modules.books.models import Book
from app.modules.books.repository import BookRepository
from app.modules.exchanges.models import BlockedPlace, ExchangeRequest, ExchangeStatus
from app.modules.reports.models import Report, ReportStatus


class AdminRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.books_repo = BookRepository(session)

    # -- Reports queue -------------------------------------------------------

    async def get_report(self, report_id: uuid.UUID) -> Report | None:
        result = await self.session.execute(select(Report).where(Report.id == report_id))
        return result.scalar_one_or_none()

    async def list_reports(self, status: ReportStatus | None) -> list[Report]:
        stmt = select(Report)
        if status is not None:
            stmt = stmt.where(Report.status == status)
        stmt = stmt.order_by(Report.created_at.asc())
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    # -- Users ----------------------------------------------------------------

    async def get_user(self, user_id: uuid.UUID) -> User | None:
        result = await self.session.execute(select(User).where(User.id == user_id))
        return result.scalar_one_or_none()

    # -- Books ------------------------------------------------------------------

    async def get_book(self, book_id: uuid.UUID) -> Book | None:
        result = await self.session.execute(select(Book).where(Book.id == book_id))
        return result.scalar_one_or_none()

    # -- Blocked places -----------------------------------------------------------

    async def list_blocked_places(self) -> list[BlockedPlace]:
        result = await self.session.execute(
            select(BlockedPlace).order_by(BlockedPlace.created_at.desc())
        )
        return list(result.scalars().all())

    async def create_blocked_place(
        self, lat: float, lng: float, place_id: str | None, reason: str | None
    ) -> BlockedPlace:
        blocked = BlockedPlace(
            lat=lat,
            lng=lng,
            place_id=place_id,
            reason=reason,
            geom=make_point(lat, lng),
        )
        self.session.add(blocked)
        await self.session.flush()
        return blocked

    async def get_blocked_place(self, blocked_place_id: uuid.UUID) -> BlockedPlace | None:
        result = await self.session.execute(
            select(BlockedPlace).where(BlockedPlace.id == blocked_place_id)
        )
        return result.scalar_one_or_none()

    async def delete_blocked_place(self, blocked: BlockedPlace) -> None:
        await self.session.delete(blocked)

    # -- Metrics -------------------------------------------------------------------

    async def count_total_users(self) -> int:
        result = await self.session.execute(
            select(func.count()).select_from(User).where(User.status != UserStatus.deleted)
        )
        return result.scalar() or 0

    async def count_daily_active_users(self) -> int:
        cutoff = datetime.now(UTC) - timedelta(days=1)
        result = await self.session.execute(
            select(func.count())
            .select_from(User)
            .where(User.last_active_at.is_not(None), User.last_active_at >= cutoff)
        )
        return result.scalar() or 0

    async def exchanges_by_status(self) -> dict[str, int]:
        result = await self.session.execute(
            select(ExchangeRequest.status, func.count())
            .group_by(ExchangeRequest.status)
        )
        return {status.value: count for status, count in result.all()}

    async def reports_by_reason(self) -> dict[str, int]:
        result = await self.session.execute(
            select(Report.reason, func.count()).group_by(Report.reason)
        )
        return {reason: count for reason, count in result.all()}

    async def count_open_reports(self) -> int:
        result = await self.session.execute(
            select(func.count())
            .select_from(Report)
            .where(Report.status.in_((ReportStatus.open, ReportStatus.reviewing)))
        )
        return result.scalar() or 0
