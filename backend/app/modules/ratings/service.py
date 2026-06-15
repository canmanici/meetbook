"""Ratings business logic — double-blind submission + reveal + aggregates."""

import uuid
from datetime import UTC, datetime

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.auth.repository import AuthRepository
from app.modules.exchanges.models import ExchangeStatus
from app.modules.exchanges.repository import ExchangeRepository
from app.modules.ratings.models import Rating
from app.modules.ratings.repository import RatingRepository
from app.modules.ratings.schemas import RatingCreateRequest, RatingListResponse, RatingView


class RatingError(Exception):
    def __init__(self, code: str, status_code: int = 400) -> None:
        self.code = code
        self.status_code = status_code


def _to_view(rating: Rating) -> RatingView:
    return RatingView(
        id=rating.id,
        exchange_request_id=rating.exchange_request_id,
        rated_by=rating.rated_by,
        rated_user=rating.rated_user,
        score=rating.score,
        comment=rating.comment,
        created_at=rating.created_at,
    )


class RatingService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.repo = RatingRepository(session)
        self.exchange_repo = ExchangeRepository(session)
        self.auth_repo = AuthRepository(session)

    async def create_rating(self, current_user_id: uuid.UUID, body: RatingCreateRequest) -> RatingView:
        exchange = await self.exchange_repo.get(body.exchange_id)
        participants = (exchange.requested_by, exchange.requested_to) if exchange else ()
        if exchange is None or current_user_id not in participants:
            raise RatingError("NOT_FOUND", 404)

        if exchange.status != ExchangeStatus.completed:
            raise RatingError("EXCHANGE_NOT_COMPLETED", 409)

        existing = await self.repo.get_by_exchange_and_rater(body.exchange_id, current_user_id)
        if existing is not None:
            raise RatingError("ALREADY_RATED", 409)

        rated_user = (
            exchange.requested_to
            if current_user_id == exchange.requested_by
            else exchange.requested_by
        )

        try:
            rating = await self.repo.create(
                exchange_request_id=body.exchange_id,
                rated_by=current_user_id,
                rated_user=rated_user,
                score=body.score,
                comment=body.comment,
            )
        except IntegrityError:
            await self.session.rollback()
            raise RatingError("ALREADY_RATED", 409)

        await self._maybe_reveal(body.exchange_id)
        await self.session.commit()
        return _to_view(rating)

    async def _maybe_reveal(self, exchange_request_id: uuid.UUID) -> None:
        """Reveal both ratings for an exchange once both sides have submitted."""
        ratings = await self.repo.list_for_exchange(exchange_request_id)
        if len(ratings) < 2:
            return

        now = datetime.now(UTC)
        for rating in ratings:
            if rating.revealed_at is None:
                rating.revealed_at = now

        for rating in ratings:
            await self.update_aggregate(rating.rated_user)

    async def update_aggregate(self, user_id: uuid.UUID) -> None:
        average, count = await self.repo.recompute_aggregate(user_id)
        user = await self.auth_repo.get_user_by_id(user_id)
        if user is not None:
            user.rating_average = round(average, 2)
            user.rating_count = count

    async def get_user_ratings(self, user_id: uuid.UUID) -> RatingListResponse:
        ratings = await self.repo.list_revealed_for_user(user_id)
        user = await self.auth_repo.get_user_by_id(user_id)
        return RatingListResponse(
            items=[_to_view(r) for r in ratings],
            rating_average=float(user.rating_average) if user else 0.0,
            rating_count=user.rating_count if user else 0,
        )
