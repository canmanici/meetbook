"""Hourly worker: reveal ratings that have timed out (14 days unrevealed)."""

from datetime import UTC, datetime, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.ratings.models import REVEAL_TIMEOUT_DAYS
from app.modules.ratings.repository import RatingRepository
from app.modules.ratings.service import RatingService


async def reveal_overdue_ratings(session: AsyncSession) -> int:
    """Reveal ratings older than `REVEAL_TIMEOUT_DAYS` whose counterpart never rated.

    Returns the number of ratings revealed.
    """
    repo = RatingRepository(session)
    service = RatingService(session)
    cutoff = datetime.now(UTC) - timedelta(days=REVEAL_TIMEOUT_DAYS)
    overdue = await repo.list_unrevealed_older_than(cutoff)

    now = datetime.now(UTC)
    revealed = 0
    for rating in overdue:
        rating.revealed_at = now
        await service.update_aggregate(rating.rated_user)
        revealed += 1

    await session.commit()
    return revealed
