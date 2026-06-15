"""Database queries for the ratings module."""

import uuid
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.ratings.models import Rating


class RatingRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get_by_exchange_and_rater(
        self, exchange_request_id: uuid.UUID, rated_by: uuid.UUID
    ) -> Rating | None:
        result = await self.session.execute(
            select(Rating).where(
                Rating.exchange_request_id == exchange_request_id,
                Rating.rated_by == rated_by,
            )
        )
        return result.scalar_one_or_none()

    async def list_for_exchange(self, exchange_request_id: uuid.UUID) -> list[Rating]:
        result = await self.session.execute(
            select(Rating).where(Rating.exchange_request_id == exchange_request_id)
        )
        return list(result.scalars().all())

    async def create(
        self,
        exchange_request_id: uuid.UUID,
        rated_by: uuid.UUID,
        rated_user: uuid.UUID,
        score: int,
        comment: str | None,
    ) -> Rating:
        rating = Rating(
            exchange_request_id=exchange_request_id,
            rated_by=rated_by,
            rated_user=rated_user,
            score=score,
            comment=comment,
        )
        self.session.add(rating)
        await self.session.flush()
        return rating

    async def list_revealed_for_user(self, user_id: uuid.UUID) -> list[Rating]:
        result = await self.session.execute(
            select(Rating)
            .where(Rating.rated_user == user_id, Rating.revealed_at.is_not(None))
            .order_by(Rating.created_at.desc())
        )
        return list(result.scalars().all())

    async def list_unrevealed_older_than(self, cutoff: datetime) -> list[Rating]:
        result = await self.session.execute(
            select(Rating).where(
                Rating.revealed_at.is_(None),
                Rating.created_at < cutoff,
            )
        )
        return list(result.scalars().all())

    async def recompute_aggregate(self, user_id: uuid.UUID) -> tuple[float, int]:
        result = await self.session.execute(
            select(func.avg(Rating.score), func.count(Rating.score)).where(
                Rating.rated_user == user_id, Rating.revealed_at.is_not(None)
            )
        )
        avg, count = result.one()
        return (float(avg) if avg is not None else 0.0, count or 0)
