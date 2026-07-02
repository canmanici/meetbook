"""Database queries for the admin module."""

import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.geo import make_point
from app.modules.auth.models import AuditLog, User, UserStatus
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

    async def list_active_user_ids(self) -> list[uuid.UUID]:
        result = await self.session.execute(select(User.id).where(User.status == UserStatus.active))
        return list(result.scalars().all())

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
            select(ExchangeRequest.status, func.count()).group_by(ExchangeRequest.status)
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

    # -- Users list/detail ----------------------------------------------------

    async def list_users(
        self,
        search: str | None = None,
        status: UserStatus | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[User], int]:
        stmt = select(User)
        count_stmt = select(func.count()).select_from(User)

        if search:
            search_pattern = f"%{search}%"
            stmt = stmt.where(User.name.ilike(search_pattern) | User.email.ilike(search_pattern))
            count_stmt = count_stmt.where(
                User.name.ilike(search_pattern) | User.email.ilike(search_pattern)
            )

        if status:
            stmt = stmt.where(User.status == status)
            count_stmt = count_stmt.where(User.status == status)

        total_result = await self.session.execute(count_stmt)
        total = total_result.scalar() or 0

        stmt = stmt.order_by(User.created_at.desc()).limit(limit).offset(offset)
        result = await self.session.execute(stmt)
        users = list(result.scalars().all())

        return users, total

    async def get_user_detail(self, user_id: uuid.UUID) -> User | None:
        result = await self.session.execute(select(User).where(User.id == user_id))
        return result.scalar_one_or_none()

    # -- Books list/detail ----------------------------------------------------

    async def list_books(
        self,
        search: str | None = None,
        available_only: bool = False,
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[Book], int]:
        stmt = select(Book)
        count_stmt = select(func.count()).select_from(Book)

        if search:
            search_pattern = f"%{search}%"
            stmt = stmt.where(Book.title.ilike(search_pattern) | Book.author.ilike(search_pattern))
            count_stmt = count_stmt.where(
                Book.title.ilike(search_pattern) | Book.author.ilike(search_pattern)
            )

        if available_only:
            stmt = stmt.where(Book.is_available == True)
            count_stmt = count_stmt.where(Book.is_available == True)

        total_result = await self.session.execute(count_stmt)
        total = total_result.scalar() or 0

        stmt = stmt.order_by(Book.created_at.desc()).limit(limit).offset(offset)
        result = await self.session.execute(stmt)
        books = list(result.scalars().all())

        return books, total

    async def get_book_detail(self, book_id: uuid.UUID) -> Book | None:
        result = await self.session.execute(select(Book).where(Book.id == book_id))
        return result.scalar_one_or_none()

    # -- Exchanges list/detail ------------------------------------------------

    async def list_exchanges(
        self, status: ExchangeStatus | None = None, limit: int = 50, offset: int = 0
    ) -> tuple[list[ExchangeRequest], int]:
        stmt = select(ExchangeRequest)
        count_stmt = select(func.count()).select_from(ExchangeRequest)

        if status:
            stmt = stmt.where(ExchangeRequest.status == status)
            count_stmt = count_stmt.where(ExchangeRequest.status == status)

        total_result = await self.session.execute(count_stmt)
        total = total_result.scalar() or 0

        stmt = stmt.order_by(ExchangeRequest.created_at.desc()).limit(limit).offset(offset)
        result = await self.session.execute(stmt)
        exchanges = list(result.scalars().all())

        return exchanges, total

    async def get_exchange_detail(self, exchange_id: uuid.UUID) -> ExchangeRequest | None:
        result = await self.session.execute(
            select(ExchangeRequest).where(ExchangeRequest.id == exchange_id)
        )
        return result.scalar_one_or_none()

    # -- Audit log ------------------------------------------------------------

    async def list_audit_logs(
        self,
        user_id: uuid.UUID | None = None,
        event_type: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[tuple[AuditLog, str | None, str | None]], int]:
        """Returns (log, user_name, user_email) tuples + total count."""
        stmt = (
            select(AuditLog, User.name, User.email)
            .select_from(AuditLog)
            .outerjoin(User, AuditLog.user_id == User.id)
        )
        count_stmt = select(func.count()).select_from(AuditLog)

        if user_id:
            stmt = stmt.where(AuditLog.user_id == user_id)
            count_stmt = count_stmt.where(AuditLog.user_id == user_id)

        if event_type:
            stmt = stmt.where(AuditLog.event_type == event_type)
            count_stmt = count_stmt.where(AuditLog.event_type == event_type)

        total_result = await self.session.execute(count_stmt)
        total = total_result.scalar() or 0

        stmt = stmt.order_by(AuditLog.created_at.desc()).limit(limit).offset(offset)
        result = await self.session.execute(stmt)
        rows = result.all()  # list of (AuditLog, name_or_None, email_or_None)

        return rows, total
