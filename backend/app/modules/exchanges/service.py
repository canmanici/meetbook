"""Exchange lifecycle business logic. Authorization checks happen first, per
TECHNICAL_ARCHITECTURE.md.
"""

import uuid
from datetime import UTC, datetime, timedelta

import redis.asyncio as aioredis
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.geo import in_turkey_bbox, make_point
from app.core.redis import get_redis
from app.modules.auth.repository import AuthRepository
from app.modules.books.repository import BookRepository, BookRow, encode_cursor
from app.modules.books.schemas import LocationOutput, PhotoView
from app.modules.exchanges.models import ExchangeRequest, ExchangeStatus, Meetup, MeetupValidationStatus
from app.modules.exchanges.repository import ExchangeRepository, Role
from app.modules.exchanges.schemas import (
    BlockedUserView,
    BlockListResponse,
    BookSummary,
    CounterpartView,
    ExchangeCreateRequest,
    ExchangeDetail,
    ExchangeListResponse,
    ExchangeSummary,
    MeetupAcceptRequest,
    MeetupDetail,
    MeetupOfferView,
    MeetupProposeRequest,
)
from app.modules.exchanges.state_machine import (
    ExchangeAction,
    TransitionError,
    check_actor,
    get_transition,
)
from app.modules.places import service as places_service
from app.modules.places.schemas import PlaceSummary

REQUEST_TTL = timedelta(days=14)
NEW_ACCOUNT_ACTIVE_REQUEST_LIMIT = 3


class ExchangeError(Exception):
    def __init__(self, code: str, status_code: int = 400) -> None:
        self.code = code
        self.status_code = status_code


def _book_summary(book_row: BookRow | None, photos: list | None = None) -> BookSummary:
    if book_row is None:
        raise ExchangeError("BOOK_NOT_FOUND", 404)
    book = book_row.book
    return BookSummary(
        id=book.id,
        title=book.title,
        author=book.author,
        category=book.category,
        condition=book.condition,
        is_available=book.is_available,
        public_location=LocationOutput(
            lat=book_row.public_location[0], lng=book_row.public_location[1]
        ),
        photos=[PhotoView(id=p.id, url=p.url, thumbnail_url=p.thumbnail_url, position=p.position) for p in (photos or [])],
    )


def _meetup_to_detail(meetup: Meetup) -> MeetupDetail:
    acknowledged = meetup.proposer_acknowledged and meetup.other_acknowledged
    requires_acknowledgment = (
        meetup.validation_status == MeetupValidationStatus.warning and not acknowledged
    )
    can_confirm = meetup.validation_status == MeetupValidationStatus.auto or acknowledged
    return MeetupDetail(
        id=meetup.id,
        place_id=meetup.place_id,
        place_name=meetup.place_name,
        address=meetup.address,
        category=meetup.category,
        lat=meetup.lat,
        lng=meetup.lng,
        validation_status=meetup.validation_status,
        scheduled_at=meetup.scheduled_at,
        proposed_by=meetup.proposed_by,
        proposer_acknowledged=meetup.proposer_acknowledged,
        other_acknowledged=meetup.other_acknowledged,
        requires_acknowledgment=requires_acknowledgment,
        can_confirm=can_confirm,
        offers=[MeetupOfferView(**offer) for offer in meetup.offers],
        created_at=meetup.created_at,
        updated_at=meetup.updated_at,
    )


class ExchangeService:
    def __init__(self, session: AsyncSession, redis: aioredis.Redis | None = None) -> None:
        self.session = session
        self.repo = ExchangeRepository(session)
        self.books_repo = BookRepository(session)
        self.auth_repo = AuthRepository(session)
        self.redis = redis or get_redis()

    async def _to_detail(
        self, request: ExchangeRequest, current_user_id: uuid.UUID
    ) -> ExchangeDetail:
        book_row = await self.books_repo.get_by_id(request.book_id)
        photos = await self.books_repo.get_photos(request.book_id)
        counterpart_id = (
            request.requested_to
            if current_user_id == request.requested_by
            else request.requested_by
        )
        counterpart = await self.auth_repo.get_user_by_id(counterpart_id)
        if counterpart is None:
            raise ExchangeError("NOT_FOUND", 404)
        meetup = await self.repo.get_meetup(request.id)
        return ExchangeDetail(
            id=request.id,
            book=_book_summary(book_row, photos),
            counterpart=CounterpartView(id=counterpart.id, name=counterpart.name),
            requested_by=request.requested_by,
            requested_to=request.requested_to,
            status=request.status,
            initial_message=request.initial_message,
            completion_marked_by=request.completion_marked_by,
            meetup=_meetup_to_detail(meetup) if meetup is not None else None,
            created_at=request.created_at,
            updated_at=request.updated_at,
            expires_at=request.expires_at,
        )

    async def _to_summary(self, request: ExchangeRequest, role: Role) -> ExchangeSummary:
        book_row = await self.books_repo.get_by_id(request.book_id)
        photos = await self.books_repo.get_photos(request.book_id)
        counterpart_id = request.requested_to if role == "sent" else request.requested_by
        counterpart = await self.auth_repo.get_user_by_id(counterpart_id)
        if counterpart is None:
            raise ExchangeError("NOT_FOUND", 404)
        return ExchangeSummary(
            id=request.id,
            book=_book_summary(book_row, photos),
            counterpart=CounterpartView(id=counterpart.id, name=counterpart.name),
            status=request.status,
            created_at=request.created_at,
            updated_at=request.updated_at,
        )

    async def create_exchange(
        self,
        current_user_id: uuid.UUID,
        current_user_completed_exchanges: int,
        body: ExchangeCreateRequest,
    ) -> ExchangeDetail:
        book_row = await self.books_repo.get_active_by_id(body.book_id)
        if book_row is None:
            raise ExchangeError("BOOK_NOT_FOUND", 404)
        book = book_row.book

        if book.owner_id == current_user_id:
            raise ExchangeError("SELF_REQUEST", 400)

        if await self.repo.is_blocked_pair(current_user_id, book.owner_id):
            # Existence-hiding: don't reveal that a block is the reason.
            raise ExchangeError("BOOK_NOT_FOUND", 404)

        if not book.is_available:
            raise ExchangeError("BOOK_UNAVAILABLE", 400)

        if await self.repo.has_active_for_book_and_requester(book.id, current_user_id):
            raise ExchangeError("DUPLICATE_REQUEST", 409)

        if current_user_completed_exchanges == 0:
            active_count = await self.repo.count_active_for_requester(current_user_id)
            if active_count >= NEW_ACCOUNT_ACTIVE_REQUEST_LIMIT:
                raise ExchangeError("NEW_ACCOUNT_LIMIT", 400)

        expires_at = datetime.now(UTC) + REQUEST_TTL
        request = await self.repo.create(
            book_id=book.id,
            requested_by=current_user_id,
            requested_to=book.owner_id,
            initial_message=body.initial_message,
            expires_at=expires_at,
        )
        await self.session.commit()
        return await self._to_detail(request, current_user_id)

    async def list_exchanges(
        self,
        current_user_id: uuid.UUID,
        role: Role,
        status: ExchangeStatus | None,
        cursor: str | None,
        limit: int,
    ) -> ExchangeListResponse:
        rows = await self.repo.list_by_role(current_user_id, role, status, cursor, limit)
        next_cursor = None
        if len(rows) == limit:
            last = rows[-1]
            next_cursor = encode_cursor(last.created_at, last.id)
        items = [await self._to_summary(request, role) for request in rows]
        return ExchangeListResponse(items=items, next_cursor=next_cursor)

    async def get_exchange(
        self, exchange_id: uuid.UUID, current_user_id: uuid.UUID
    ) -> ExchangeDetail:
        request = await self.repo.get(exchange_id)
        participants = (request.requested_by, request.requested_to) if request else ()
        if request is None or current_user_id not in participants:
            raise ExchangeError("NOT_FOUND", 404)
        return await self._to_detail(request, current_user_id)

    async def _transition(
        self, exchange_id: uuid.UUID, current_user_id: uuid.UUID, action: ExchangeAction
    ) -> ExchangeDetail:
        request = await self.repo.get_for_update(exchange_id)
        participants = (request.requested_by, request.requested_to) if request else ()
        if request is None or current_user_id not in participants:
            raise ExchangeError("NOT_FOUND", 404)

        try:
            next_status, actor = get_transition(request.status, action)
        except TransitionError as e:
            raise ExchangeError(e.code, e.status_code) from e

        if not check_actor(
            actor,
            current_user_id,
            request.requested_by,
            request.requested_to,
            request.completion_marked_by,
        ):
            raise ExchangeError("WRONG_ACTOR", 409)

        request.status = next_status
        request.updated_at = datetime.now(UTC)

        if action is ExchangeAction.complete:
            request.completion_marked_by = current_user_id

        if action is ExchangeAction.accept:
            await self.repo.create_chat(request.id)

        if action is ExchangeAction.confirm_completion:
            book_row = await self.books_repo.get_active_by_id(request.book_id)
            if book_row is not None:
                await self.books_repo.update(book_row.book, {"is_available": False})

            requester = await self.auth_repo.get_user_by_id(request.requested_by)
            owner = await self.auth_repo.get_user_by_id(request.requested_to)
            if requester is not None:
                requester.completed_exchanges += 1
            if owner is not None:
                owner.completed_exchanges += 1

        await self.session.commit()
        return await self._to_detail(request, current_user_id)

    async def accept(self, exchange_id: uuid.UUID, current_user_id: uuid.UUID) -> ExchangeDetail:
        return await self._transition(exchange_id, current_user_id, ExchangeAction.accept)

    async def reject(self, exchange_id: uuid.UUID, current_user_id: uuid.UUID) -> ExchangeDetail:
        return await self._transition(exchange_id, current_user_id, ExchangeAction.reject)

    async def cancel(self, exchange_id: uuid.UUID, current_user_id: uuid.UUID) -> ExchangeDetail:
        return await self._transition(exchange_id, current_user_id, ExchangeAction.cancel)

    async def complete(self, exchange_id: uuid.UUID, current_user_id: uuid.UUID) -> ExchangeDetail:
        return await self._transition(exchange_id, current_user_id, ExchangeAction.complete)

    async def confirm_completion(
        self, exchange_id: uuid.UUID, current_user_id: uuid.UUID
    ) -> ExchangeDetail:
        return await self._transition(
            exchange_id, current_user_id, ExchangeAction.confirm_completion
        )

    async def propose_meetup(
        self, exchange_id: uuid.UUID, current_user_id: uuid.UUID, body: MeetupProposeRequest
    ) -> ExchangeDetail:
        request = await self.repo.get_for_update(exchange_id)
        participants = (request.requested_by, request.requested_to) if request else ()
        if request is None or current_user_id not in participants:
            raise ExchangeError("NOT_FOUND", 404)

        try:
            next_status, actor = get_transition(request.status, ExchangeAction.propose_meetup)
        except TransitionError as e:
            raise ExchangeError(e.code, e.status_code) from e

        if not check_actor(
            actor,
            current_user_id,
            request.requested_by,
            request.requested_to,
            request.completion_marked_by,
        ):
            raise ExchangeError("WRONG_ACTOR", 409)

        offer_dicts = []
        any_warning = False
        for offer in body.offers:
            if not in_turkey_bbox(offer.lat, offer.lng) or not await self.repo.is_in_turkey(
                offer.lat, offer.lng
            ):
                raise ExchangeError("OUTSIDE_TURKEY", 400)

            if await self.repo.is_near_blocked_place(offer.lat, offer.lng):
                raise ExchangeError("BLOCKED_PLACE", 400)

            validation_status = (
                MeetupValidationStatus.auto
                if offer.category in places_service.SAFE_CATEGORIES
                else MeetupValidationStatus.warning
            )
            if validation_status == MeetupValidationStatus.warning:
                any_warning = True
            offer_dicts.append(
                {**offer.model_dump(mode="json"), "validation_status": validation_status.value}
            )

        primary = body.offers[0]
        primary_validation_status = MeetupValidationStatus(offer_dicts[0]["validation_status"])

        await self.repo.upsert_meetup(
            request.id,
            {
                "place_id": primary.place_id,
                "place_name": primary.place_name,
                "address": primary.address,
                "category": primary.category,
                "lat": primary.lat,
                "lng": primary.lng,
                "validation_status": primary_validation_status,
                "scheduled_at": primary.scheduled_at,
                "proposed_by": current_user_id,
                "proposer_acknowledged": body.acknowledge_warning if any_warning else False,
                "other_acknowledged": False,
                "offers": offer_dicts,
            },
        )

        request.status = next_status
        request.updated_at = datetime.now(UTC)
        await self.session.commit()
        return await self._to_detail(request, current_user_id)

    async def accept_meetup(
        self, exchange_id: uuid.UUID, current_user_id: uuid.UUID, body: MeetupAcceptRequest
    ) -> ExchangeDetail:
        request = await self.repo.get_for_update(exchange_id)
        participants = (request.requested_by, request.requested_to) if request else ()
        if request is None or current_user_id not in participants:
            raise ExchangeError("NOT_FOUND", 404)

        meetup = await self.repo.get_meetup(request.id)
        if meetup is None:
            raise ExchangeError("NOT_FOUND", 404)

        if current_user_id == meetup.proposed_by:
            raise ExchangeError("ACCEPT_OWN_PROPOSAL", 409)

        offers = meetup.offers or []
        if body.offer_index >= len(offers):
            raise ExchangeError("INVALID_OFFER", 400)
        chosen = offers[body.offer_index]
        chosen_validation_status = MeetupValidationStatus(chosen["validation_status"])

        try:
            next_status, actor = get_transition(request.status, ExchangeAction.accept_meetup)
        except TransitionError as e:
            raise ExchangeError(e.code, e.status_code) from e

        if not check_actor(
            actor,
            current_user_id,
            request.requested_by,
            request.requested_to,
            request.completion_marked_by,
        ):
            raise ExchangeError("WRONG_ACTOR", 409)

        if chosen_validation_status == MeetupValidationStatus.warning:
            if not meetup.other_acknowledged and not body.acknowledge_warning:
                raise ExchangeError("ACKNOWLEDGMENT_REQUIRED", 400)
            if not meetup.proposer_acknowledged:
                raise ExchangeError("ACKNOWLEDGMENT_REQUIRED", 400)
            if body.acknowledge_warning:
                meetup.other_acknowledged = True

        meetup.place_id = chosen.get("place_id")
        meetup.place_name = chosen["place_name"]
        meetup.address = chosen.get("address")
        meetup.category = chosen.get("category")
        meetup.lat = chosen["lat"]
        meetup.lng = chosen["lng"]
        meetup.geom = make_point(chosen["lat"], chosen["lng"])
        meetup.scheduled_at = datetime.fromisoformat(chosen["scheduled_at"])
        meetup.validation_status = chosen_validation_status
        meetup.updated_at = datetime.now(UTC)

        request.status = next_status
        request.updated_at = datetime.now(UTC)
        await self.session.commit()
        return await self._to_detail(request, current_user_id)

    async def reject_meetup(
        self, exchange_id: uuid.UUID, current_user_id: uuid.UUID
    ) -> ExchangeDetail:
        return await self._transition(exchange_id, current_user_id, ExchangeAction.reject_meetup)

    async def block_user(self, blocker_id: uuid.UUID, blocked_id: uuid.UUID) -> None:
        if blocker_id == blocked_id:
            raise ExchangeError("SELF_BLOCK", 400)
        await self.repo.create_block(blocker_id, blocked_id)
        await self.session.commit()

    async def unblock_user(self, blocker_id: uuid.UUID, blocked_id: uuid.UUID) -> None:
        await self.repo.delete_block(blocker_id, blocked_id)
        await self.session.commit()

    async def list_blocked_users(self, blocker_id: uuid.UUID) -> BlockListResponse:
        blocks = await self.repo.list_blocked_by(blocker_id)
        return BlockListResponse(
            items=[
                BlockedUserView(user_id=b.blocked_id, created_at=b.created_at) for b in blocks
            ]
        )

    async def suggest_meetup_places(
        self, exchange_id: uuid.UUID, current_user_id: uuid.UUID
    ) -> list[PlaceSummary]:
        request = await self.repo.get(exchange_id)
        participants = (request.requested_by, request.requested_to) if request else ()
        if request is None or current_user_id not in participants:
            raise ExchangeError("NOT_FOUND", 404)

        book_row = await self.books_repo.get_by_id(request.book_id)
        if book_row is None:
            raise ExchangeError("BOOK_NOT_FOUND", 404)
        lat, lng = book_row.location

        other_user_id = (
            request.requested_to
            if current_user_id == request.requested_by
            else request.requested_by
        )
        other_books = await self.books_repo.list_by_owner(other_user_id, None, 1)
        if other_books:
            other_lat, other_lng = other_books[0].location
            lat = (lat + other_lat) / 2
            lng = (lng + other_lng) / 2

        return await places_service.nearby(self.redis, lat, lng)
