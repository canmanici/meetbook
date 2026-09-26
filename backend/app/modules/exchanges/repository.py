"""Database queries for the exchanges module."""

import uuid
from datetime import UTC, datetime
from typing import Any, Literal

from sqlalchemy import and_, func, or_, select, text, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.geo import make_point
from app.modules.books.repository import decode_ts_cursor
from app.modules.exchanges.models import (
    ACTIVE_LOAN_STATUSES,
    ACTIVE_STATUSES,
    Block,
    Chat,
    ExchangeMode,
    ExchangeRequest,
    ExchangeStatus,
    Meetup,
)

Role = Literal["sent", "received"]


class ExchangeRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def create(
        self,
        book_id: uuid.UUID,
        requested_by: uuid.UUID,
        requested_to: uuid.UUID,
        initial_message: str,
        expires_at: datetime,
        mode: ExchangeMode = ExchangeMode.trade,
        loan_duration_days: int | None = None,
    ) -> ExchangeRequest:
        request = ExchangeRequest(
            book_id=book_id,
            requested_by=requested_by,
            requested_to=requested_to,
            initial_message=initial_message,
            status=ExchangeStatus.pending,
            expires_at=expires_at,
            mode=mode,
            loan_duration_days=loan_duration_days,
        )
        self.session.add(request)
        await self.session.flush()
        return request

    async def has_active_loan_as_borrower(self, requester_id: uuid.UUID) -> bool:
        """True if the user currently holds a borrowed book (single active loan rule)."""
        stmt = (
            select(func.count())
            .select_from(ExchangeRequest)
            .where(
                ExchangeRequest.requested_by == requester_id,
                ExchangeRequest.mode == ExchangeMode.borrow,
                ExchangeRequest.status.in_(ACTIVE_LOAN_STATUSES),
            )
        )
        result = await self.session.execute(stmt)
        return (result.scalar() or 0) > 0

    async def list_due_loans(
        self, statuses: tuple[ExchangeStatus, ...], before: datetime
    ) -> list[ExchangeRequest]:
        """Active loans whose due_at is at/before the given instant (worker use)."""
        stmt = select(ExchangeRequest).where(
            ExchangeRequest.mode == ExchangeMode.borrow,
            ExchangeRequest.status.in_(statuses),
            ExchangeRequest.due_at.isnot(None),
            ExchangeRequest.due_at <= before,
        )
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def get(self, exchange_id: uuid.UUID) -> ExchangeRequest | None:
        result = await self.session.execute(
            select(ExchangeRequest).where(ExchangeRequest.id == exchange_id)
        )
        return result.scalar_one_or_none()

    async def get_for_update(self, exchange_id: uuid.UUID) -> ExchangeRequest | None:
        result = await self.session.execute(
            select(ExchangeRequest).where(ExchangeRequest.id == exchange_id).with_for_update()
        )
        return result.scalar_one_or_none()

    async def list_by_role(
        self,
        user_id: uuid.UUID,
        role: Role,
        status: ExchangeStatus | None,
        cursor: str | None,
        limit: int,
    ) -> list[ExchangeRequest]:
        column = ExchangeRequest.requested_by if role == "sent" else ExchangeRequest.requested_to
        stmt = select(ExchangeRequest).where(column == user_id)
        if status is not None:
            stmt = stmt.where(ExchangeRequest.status == status)
        if cursor:
            cursor_created_at, cursor_id = decode_ts_cursor(cursor)
            stmt = stmt.where(
                or_(
                    ExchangeRequest.created_at < cursor_created_at,
                    and_(
                        ExchangeRequest.created_at == cursor_created_at,
                        ExchangeRequest.id < cursor_id,
                    ),
                )
            )
        stmt = stmt.order_by(ExchangeRequest.created_at.desc(), ExchangeRequest.id.desc()).limit(
            limit
        )
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def has_active_for_book_and_requester(
        self, book_id: uuid.UUID, requester_id: uuid.UUID
    ) -> bool:
        stmt = (
            select(func.count())
            .select_from(ExchangeRequest)
            .where(
                ExchangeRequest.book_id == book_id,
                ExchangeRequest.requested_by == requester_id,
                ExchangeRequest.status.in_(ACTIVE_STATUSES),
            )
        )
        result = await self.session.execute(stmt)
        return (result.scalar() or 0) > 0

    async def has_active_request_for_book(self, book_id: uuid.UUID) -> bool:
        stmt = (
            select(func.count())
            .select_from(ExchangeRequest)
            .where(
                ExchangeRequest.book_id == book_id,
                ExchangeRequest.status.in_(ACTIVE_STATUSES),
            )
        )
        result = await self.session.execute(stmt)
        return (result.scalar() or 0) > 0

    async def cancel_active_for_book(self, book_id: uuid.UUID) -> None:
        """Cancel all active exchange requests for a given book (book-level cascade)."""
        stmt = (
            update(ExchangeRequest)
            .where(
                ExchangeRequest.book_id == book_id,
                ExchangeRequest.status.in_(ACTIVE_STATUSES),
            )
            .values(
                status=ExchangeStatus.cancelled,
                updated_at=datetime.now(UTC),
            )
        )
        await self.session.execute(stmt)

    async def count_active_for_requester(self, user_id: uuid.UUID) -> int:
        stmt = (
            select(func.count())
            .select_from(ExchangeRequest)
            .where(
                ExchangeRequest.requested_by == user_id,
                ExchangeRequest.status.in_(ACTIVE_STATUSES),
            )
        )
        result = await self.session.execute(stmt)
        return result.scalar() or 0

    async def cancel_all_active_for_book(self, book_id: uuid.UUID) -> int:
        """Cancel all active exchange requests for a book. Returns count cancelled."""
        stmt = (
            select(ExchangeRequest)
            .where(
                ExchangeRequest.book_id == book_id,
                ExchangeRequest.status.in_(ACTIVE_STATUSES),
            )
            .with_for_update()
        )
        result = await self.session.execute(stmt)
        requests = list(result.scalars().all())
        for req in requests:
            req.status = ExchangeStatus.cancelled
        await self.session.flush()
        return len(requests)

    async def is_blocked_pair(self, user_a: uuid.UUID, user_b: uuid.UUID) -> bool:
        stmt = (
            select(func.count())
            .select_from(Block)
            .where(
                or_(
                    and_(Block.blocker_id == user_a, Block.blocked_id == user_b),
                    and_(Block.blocker_id == user_b, Block.blocked_id == user_a),
                )
            )
        )
        result = await self.session.execute(stmt)
        return (result.scalar() or 0) > 0

    async def create_block(self, blocker_id: uuid.UUID, blocked_id: uuid.UUID) -> None:
        stmt = (
            pg_insert(Block)
            .values(blocker_id=blocker_id, blocked_id=blocked_id)
            .on_conflict_do_nothing(index_elements=["blocker_id", "blocked_id"])
        )
        await self.session.execute(stmt)

    async def delete_block(self, blocker_id: uuid.UUID, blocked_id: uuid.UUID) -> None:
        stmt = select(Block).where(Block.blocker_id == blocker_id, Block.blocked_id == blocked_id)
        result = await self.session.execute(stmt)
        block = result.scalar_one_or_none()
        if block is not None:
            await self.session.delete(block)

    async def list_blocked_by(self, blocker_id: uuid.UUID) -> list[Block]:
        stmt = select(Block).where(Block.blocker_id == blocker_id)
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def create_chat(self, exchange_request_id: uuid.UUID) -> None:
        stmt = (
            pg_insert(Chat)
            .values(exchange_request_id=exchange_request_id)
            .on_conflict_do_nothing(index_elements=["exchange_request_id"])
        )
        await self.session.execute(stmt)

    # -----------------------------------------------------------------------
    # Meetups / geofencing
    # -----------------------------------------------------------------------

    async def is_in_turkey(self, lat: float, lng: float) -> bool:
        # Use ST_DWithin with 2km buffer instead of ST_Contains so coastal
        # locations (e.g. Kadıköy/Moda, Dolmabahçe) aren't rejected due to
        # the hand-drawn polygon's coarse coastline. 2km keeps Greek islands
        # like Rhodes (~20km off coast) excluded.  See gh issue #xxx.
        stmt = text(
            "SELECT ST_DWithin(geom, "
            "ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography, "
            ":buffer) "
            "FROM country_boundaries WHERE name = 'turkey'"
        )
        result = await self.session.execute(stmt, {"lat": lat, "lng": lng, "buffer": 2000})
        return bool(result.scalar())

    async def is_near_blocked_place(self, lat: float, lng: float, radius_m: float = 100) -> bool:
        stmt = text(
            "SELECT EXISTS (SELECT 1 FROM blocked_places "
            "WHERE ST_DWithin(geom, ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography, :radius))"
        )
        result = await self.session.execute(stmt, {"lat": lat, "lng": lng, "radius": radius_m})
        return bool(result.scalar())

    async def get_meetup(self, exchange_request_id: uuid.UUID) -> Meetup | None:
        result = await self.session.execute(
            select(Meetup).where(Meetup.exchange_request_id == exchange_request_id)
        )
        return result.scalar_one_or_none()

    async def upsert_meetup(self, exchange_request_id: uuid.UUID, fields: dict[str, Any]) -> Meetup:
        meetup = await self.get_meetup(exchange_request_id)
        point = make_point(fields["lat"], fields["lng"])
        if meetup is None:
            meetup = Meetup(exchange_request_id=exchange_request_id, geom=point, **fields)
            self.session.add(meetup)
            await self.session.flush()
            return meetup

        for key, value in fields.items():
            setattr(meetup, key, value)
        meetup.geom = point
        meetup.updated_at = datetime.now(UTC)
        await self.session.flush()
        return meetup
