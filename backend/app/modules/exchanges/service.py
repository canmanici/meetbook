"""Exchange lifecycle business logic. Authorization checks happen first, per
TECHNICAL_ARCHITECTURE.md.
"""

import json
import logging
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import redis.asyncio as aioredis
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.geo import in_turkey_bbox, make_point
from app.core.redis import get_redis
from app.modules.auth.models import User
from app.modules.auth.repository import AuthRepository
from app.modules.auth.trust import compute_trust
from app.modules.books.repository import BookRepository, BookRow, encode_ts_cursor
from app.modules.books.schemas import LocationOutput, PhotoView
from app.modules.credits.service import CreditError, CreditService
from app.modules.exchanges.models import (
    ACTIVE_LOAN_STATUSES,
    Chat,
    ExchangeMode,
    ExchangeRequest,
    ExchangeStatus,
    ExtensionStatus,
    Meetup,
    MeetupValidationStatus,
    ReadingBuddy,
    ReadingBuddyStatus,
)
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
    ExtensionRequestBody,
    LendRequest,
    MeetupAcceptRequest,
    MeetupDetail,
    MeetupOfferView,
    MeetupProposeRequest,
    ReadingBuddyView,
    ReturnRequest,
    TrustView,
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


def _trust_view(user: User) -> TrustView:
    result = compute_trust(
        rating_average=float(user.rating_average or 0),
        loans_borrowed_count=user.loans_borrowed_count,
        loans_returned_on_time=user.loans_returned_on_time,
        loans_returned_late=user.loans_returned_late,
        trust_score_override=(
            float(user.trust_score_override) if user.trust_score_override is not None else None
        ),
    )
    return TrustView(
        score=result.score,
        badge=result.badge,
        label=result.label,
        on_time_rate=result.on_time_rate,
        loans_borrowed_count=result.loans_borrowed_count,
        edu_verified=user.edu_verified_at is not None,
        teacher=user.teacher_verified_at is not None,
    )


# Open request states where the book has not been handed over yet.
PRE_HANDOVER_STATUSES = (
    ExchangeStatus.pending,
    ExchangeStatus.accepted,
    ExchangeStatus.meetup_proposed,
    ExchangeStatus.meetup_confirmed,
    ExchangeStatus.completion_pending,
)


class ExchangeError(Exception):
    def __init__(self, code: str, status_code: int = 400) -> None:
        self.code = code
        self.status_code = status_code

    @classmethod
    def from_credit(cls, e: CreditError) -> "ExchangeError":
        return cls(e.code, e.status_code)


def _book_summary(book_row: BookRow | None, photos: list[Any] | None = None) -> BookSummary:
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
        photos=[
            PhotoView(id=p.id, url=p.url, thumbnail_url=p.thumbnail_url, position=p.position)
            for p in (photos or [])
        ],
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


logger = logging.getLogger(__name__)


class ExchangeService:
    def __init__(self, session: AsyncSession, redis: aioredis.Redis | None = None) -> None:
        self.session = session
        self.repo = ExchangeRepository(session)
        self.books_repo = BookRepository(session)
        self.auth_repo = AuthRepository(session)
        self.redis = redis or get_redis()

    async def _send_system_message(
        self, exchange_id: uuid.UUID, action: str, text: str, actor_id: uuid.UUID | None = None
    ) -> None:
        """Post a system bubble into the exchange's chat so both sides see every
        lifecycle event (accept, meetup, lend/return, extension, ...) inline in
        the DM, and push-notify whichever participant didn't trigger it.

        Before accept there is no chat yet (reject/cancel of a pending
        request): the inline message is skipped but the other party is still
        notified — otherwise a rejected requester never finds out."""
        from app.modules.chat.repository import ChatRepository
        from app.modules.chat.schemas import MessageView
        from app.modules.chat.service import ConnectionManager, publish_message
        from app.modules.notifications.service import NotificationService

        chat_repo = ChatRepository(self.session)
        chat = await chat_repo.get_chat_by_exchange(exchange_id)
        if chat is not None:
            msg = await chat_repo.create_message(
                chat.id, None, text, message_type="system", extra={"action": action}
            )
            await self.session.commit()

            view = MessageView(
                id=msg.id,
                chat_id=msg.chat_id,
                sender_id=None,
                message_type="system",
                text=msg.text,
                created_at=msg.created_at,
                extra=msg.extra,
            )
            payload = {
                "type": "message",
                "message": view.model_dump(mode="json"),
                "sender_id": None,
            }
            await ConnectionManager.broadcast_to_chat(chat.id, payload, repo=chat_repo)
            await publish_message(chat.id, payload)

        exchange = await self.repo.get(exchange_id)
        if exchange is None:
            return
        other_members = [m for m in (exchange.requested_by, exchange.requested_to) if m != actor_id]
        actor = await self.auth_repo.get_user_by_id(actor_id) if actor_id else None

        notif_svc = NotificationService(self.session)
        for member_id in other_members:
            await notif_svc.notify(
                member_id,
                "chat_system",
                {"exchange_id": str(exchange_id), "action": action},
                title=actor.name if actor and actor.name else "MeetBook",
                body=text,
                skip_push_if_online=True,
            )
        await self.session.commit()

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
        rb_result = await self.session.execute(
            select(ReadingBuddy).where(ReadingBuddy.exchange_id == request.id)
        )
        reading_buddy = rb_result.scalar_one_or_none()
        return ExchangeDetail(
            id=request.id,
            book=_book_summary(book_row, photos),
            counterpart=CounterpartView(
                id=counterpart.id,
                name=counterpart.name,
                avatar_url=counterpart.avatar_url,
                trust=_trust_view(counterpart),
            ),
            requested_by=request.requested_by,
            requested_to=request.requested_to,
            status=request.status,
            initial_message=request.initial_message,
            completion_marked_by=request.completion_marked_by,
            meetup=_meetup_to_detail(meetup) if meetup is not None else None,
            mode=request.mode,
            loan_duration_days=request.loan_duration_days,
            due_at=request.due_at,
            lent_at=request.lent_at,
            lent_photo_url=request.lent_photo_url,
            returned_photo_url=request.returned_photo_url,
            returned_marked_by=request.returned_marked_by,
            extension_status=request.extension_status,
            extension_requested_days=request.extension_requested_days,
            retired_by=request.retired_by,
            retired_at=request.retired_at,
            reading_buddy=self._reading_buddy_view(reading_buddy)
            if reading_buddy is not None
            else None,
            created_at=request.created_at,
            updated_at=request.updated_at,
            expires_at=request.expires_at,
        )

    @staticmethod
    def _reading_buddy_view(buddy: ReadingBuddy) -> ReadingBuddyView:
        return ReadingBuddyView(
            id=buddy.id,
            exchange_id=buddy.exchange_id,
            user_id=buddy.user_id,
            buddy_id=buddy.buddy_id,
            chat_id=buddy.chat_id,
            book_id=buddy.book_id,
            status=buddy.status,
            created_at=buddy.created_at,
        )

    @staticmethod
    def _build_summary(
        request: ExchangeRequest,
        book_row: BookRow | None,
        photos: list[Any],
        counterpart: User | None,
    ) -> ExchangeSummary:
        if counterpart is None:
            raise ExchangeError("NOT_FOUND", 404)
        return ExchangeSummary(
            id=request.id,
            book=_book_summary(book_row, photos),
            counterpart=CounterpartView(
                id=counterpart.id,
                name=counterpart.name,
                avatar_url=counterpart.avatar_url,
                trust=_trust_view(counterpart),
            ),
            status=request.status,
            mode=request.mode,
            due_at=request.due_at,
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

        # Locks the requester row, so concurrent requests can't double-spend
        # the same credit (or both pass the single-active-loan check below).
        try:
            await CreditService(self.session).check_can_request(current_user_id, body.mode)
        except CreditError as e:
            raise ExchangeError.from_credit(e) from e

        # Single active loan rule: a borrower may hold only one borrowed book at a time.
        if body.mode is ExchangeMode.borrow:
            if await self.repo.has_active_loan_as_borrower(current_user_id):
                raise ExchangeError("ACTIVE_LOAN_EXISTS", 409)

        expires_at = datetime.now(UTC) + REQUEST_TTL
        request = await self.repo.create(
            book_id=book.id,
            requested_by=current_user_id,
            requested_to=book.owner_id,
            initial_message=body.initial_message,
            expires_at=expires_at,
            mode=body.mode,
            loan_duration_days=body.loan_duration_days,
        )
        await self.session.commit()
        await self._notify_new_request(request, book.title)
        return await self._to_detail(request, current_user_id)

    async def _notify_new_request(self, request: ExchangeRequest, book_title: str) -> None:
        """Tell the owner someone wants their book — there is no chat before
        accept, so this is the only way they learn about the request."""
        from app.modules.notifications.service import NotificationService

        try:
            requester = await self.auth_repo.get_user_by_id(request.requested_by)
            name = requester.name if requester and requester.name else "Biri"
            verb = "ödünç almak" if request.mode is ExchangeMode.borrow else "takas etmek"
            await NotificationService(self.session).notify(
                request.requested_to,
                "exchange_request",
                {"exchange_id": str(request.id), "book_id": str(request.book_id)},
                title="Yeni takas isteği",
                body=f"{name}, “{book_title}” kitabını {verb} istiyor",
            )
            await self.session.commit()
        except Exception:
            logger.exception("New-request notification failed for exchange %s", request.id)

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
            next_cursor = encode_ts_cursor(last.created_at, last.id)
        # Batch-load books, photos and counterparts: 3 queries per page instead
        # of 3 per row.
        book_ids = [r.book_id for r in rows]
        books = await self.books_repo.get_by_ids(book_ids)
        photos = await self.books_repo.get_photos_batch(book_ids)
        users = await self.auth_repo.get_users_by_ids(
            r.requested_to if role == "sent" else r.requested_by for r in rows
        )
        items = [
            self._build_summary(
                request,
                books.get(request.book_id),
                photos.get(request.book_id, []),
                users.get(request.requested_to if role == "sent" else request.requested_by),
            )
            for request in rows
        ]
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

        previous_status = request.status
        request.status = next_status
        request.updated_at = datetime.now(UTC)

        if action is ExchangeAction.cancel and previous_status in ACTIVE_LOAN_STATUSES:
            # Loan cancelled while the book is still out (lost/dispute): the
            # borrower's trust stats record it as a late, unreturned loan.
            await self.session.execute(
                update(User)
                .where(User.id == request.requested_by)
                .values(
                    loans_borrowed_count=User.loans_borrowed_count + 1,
                    loans_returned_late=User.loans_returned_late + 1,
                )
            )
            # The owner is compensated with the deposit; the borrower can't borrow again.
            await CreditService(self.session).forfeit_deposit(request)

        if action is ExchangeAction.complete:
            request.completion_marked_by = current_user_id

        if action is ExchangeAction.accept:
            # The book may have been deleted, taken down, handed to someone
            # else, or the pair may have blocked each other since the request.
            book_row = await self.books_repo.get_active_by_id(request.book_id)
            if book_row is None or not book_row.book.is_available:
                raise ExchangeError("BOOK_UNAVAILABLE", 409)
            if await self.repo.is_blocked_pair(request.requested_by, request.requested_to):
                raise ExchangeError("NOT_FOUND", 404)
            await self.repo.create_chat(request.id)

        if action is ExchangeAction.confirm_completion:
            book_row = await self.books_repo.get_active_by_id(request.book_id)
            if book_row is not None:
                await self.books_repo.update(book_row.book, {"is_available": False})
            # The book has changed hands — close every other open (pre-loan)
            # request for it so nobody else can still accept/complete it.
            others = await self.session.execute(
                select(ExchangeRequest)
                .where(
                    ExchangeRequest.book_id == request.book_id,
                    ExchangeRequest.id != request.id,
                    ExchangeRequest.status.in_(PRE_HANDOVER_STATUSES),
                )
                .with_for_update()
            )
            for other in others.scalars().all():
                other.status = ExchangeStatus.cancelled
                other.updated_at = datetime.now(UTC)

            await self.session.execute(
                update(User)
                .where(User.id == request.requested_by)
                .values(completed_exchanges=User.completed_exchanges + 1)
            )
            await self.session.execute(
                update(User)
                .where(User.id == request.requested_to)
                .values(completed_exchanges=User.completed_exchanges + 1)
            )
            # A permanent hand-over (any mode that ends here): owner +1, requester -1.
            await CreditService(self.session).settle_trade(request)

        await self.session.commit()

        system_message = {
            ExchangeAction.accept: ("exchange_accepted", "Takas isteğini kabul etti"),
            ExchangeAction.reject: ("exchange_rejected", "Takas isteğini reddetti"),
            ExchangeAction.cancel: ("exchange_cancelled", "Takası iptal etti"),
            ExchangeAction.complete: (
                "exchange_completion_marked",
                "Takası tamamlandı olarak işaretledi, onayın bekleniyor",
            ),
            ExchangeAction.confirm_completion: ("exchange_completed", "Takas tamamlandı"),
            ExchangeAction.reject_meetup: ("meetup_rejected", "Buluşma önerisini reddetti"),
        }.get(action)
        if system_message is not None:
            action_key, text = system_message
            await self._send_system_message(exchange_id, action_key, text, current_user_id)

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

    # -----------------------------------------------------------------------
    # Borrow-mode lifecycle
    # -----------------------------------------------------------------------

    async def _load_for_transition(
        self, exchange_id: uuid.UUID, current_user_id: uuid.UUID, action: ExchangeAction
    ) -> tuple[ExchangeRequest, ExchangeStatus]:
        """Lock the request, validate the transition + actor, return (request, next_status)."""
        request = await self.repo.get_for_update(exchange_id)
        participants = (request.requested_by, request.requested_to) if request else ()
        if request is None or current_user_id not in participants:
            raise ExchangeError("NOT_FOUND", 404)
        if request.mode is not ExchangeMode.borrow:
            raise ExchangeError("NOT_A_LOAN", 409)
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
        return request, next_status

    async def lend(
        self, exchange_id: uuid.UUID, current_user_id: uuid.UUID, body: LendRequest
    ) -> ExchangeDetail:
        request, next_status = await self._load_for_transition(
            exchange_id, current_user_id, ExchangeAction.mark_lent
        )
        # Re-check the single active loan rule for the borrower at hand-over time.
        if await self.repo.has_active_loan_as_borrower(request.requested_by):
            raise ExchangeError("ACTIVE_LOAN_EXISTS", 409)
        try:
            await CreditService(self.session).hold_deposit(request)
        except CreditError as e:
            raise ExchangeError.from_credit(e) from e
        now = datetime.now(UTC)
        request.status = next_status
        request.lent_at = now
        request.lent_photo_url = body.photo_url
        request.due_at = now + timedelta(days=request.loan_duration_days or 0)
        request.updated_at = now
        # Book is off the market while it is on loan.
        book_row = await self.books_repo.get_by_id(request.book_id)
        if book_row is not None:
            await self.books_repo.update(book_row.book, {"is_available": False})
        await self.session.commit()
        await self._send_system_message(
            exchange_id, "book_lent", "Kitabı teslim etti", current_user_id
        )
        return await self._to_detail(request, current_user_id)

    async def mark_returned(
        self, exchange_id: uuid.UUID, current_user_id: uuid.UUID, body: ReturnRequest
    ) -> ExchangeDetail:
        request, next_status = await self._load_for_transition(
            exchange_id, current_user_id, ExchangeAction.mark_returned
        )
        now = datetime.now(UTC)
        request.status = next_status
        request.returned_marked_by = current_user_id
        request.returned_photo_url = body.photo_url
        request.returned_on_time = request.due_at is None or now <= request.due_at
        request.updated_at = now
        await self.session.commit()
        await self._send_system_message(
            exchange_id, "book_returned", "Kitabı iade etti", current_user_id
        )
        return await self._to_detail(request, current_user_id)

    async def confirm_return(
        self, exchange_id: uuid.UUID, current_user_id: uuid.UUID
    ) -> ExchangeDetail:
        request, next_status = await self._load_for_transition(
            exchange_id, current_user_id, ExchangeAction.confirm_return
        )
        now = datetime.now(UTC)
        request.status = next_status
        request.returned_confirmed_at = now
        request.updated_at = now

        # The book becomes available again — a loan does not consume it.
        book_row = await self.books_repo.get_by_id(request.book_id)
        if book_row is not None:
            await self.books_repo.update(book_row.book, {"is_available": True})

        borrower_updates = {
            "loans_borrowed_count": User.loans_borrowed_count + 1,
            "completed_exchanges": User.completed_exchanges + 1,
        }
        if request.returned_on_time:
            borrower_updates["loans_returned_on_time"] = User.loans_returned_on_time + 1
        else:
            borrower_updates["loans_returned_late"] = User.loans_returned_late + 1

        await self.session.execute(
            update(User).where(User.id == request.requested_by).values(**borrower_updates)
        )
        await self.session.execute(
            update(User)
            .where(User.id == request.requested_to)
            .values(completed_exchanges=User.completed_exchanges + 1)
        )
        await CreditService(self.session).release_deposit(request)

        await self.session.commit()
        await self._send_system_message(
            exchange_id, "loan_completed", "İadeyi onayladı, takas tamamlandı", current_user_id
        )
        return await self._to_detail(request, current_user_id)

    async def upload_loan_photo(
        self,
        exchange_id: uuid.UUID,
        current_user_id: uuid.UUID,
        file_bytes: bytes,
        content_type: str,
    ) -> str:
        """Upload a hand-over/return photo for a loan; any participant may upload."""
        from app.core.s3 import upload_photo

        request = await self.repo.get(exchange_id)
        participants = (request.requested_by, request.requested_to) if request else ()
        if request is None or current_user_id not in participants:
            raise ExchangeError("NOT_FOUND", 404)
        if len(file_bytes) > 10 * 1024 * 1024:
            raise ExchangeError("FILE_TOO_LARGE", 400)
        # Same rules as book photos: type from the bytes (the stored
        # Content-Type is served back, so a fake label is a stored-XSS
        # vector), image-bomb limits, GPS/EXIF stripped.
        from app.core.image_safety import PHOTO_LIMITS, UnsafeImageError, sanitize_image

        try:
            image = sanitize_image(file_bytes, PHOTO_LIMITS)
        except UnsafeImageError as exc:
            raise ExchangeError(exc.code, 400) from None
        file_bytes, content_type = image.data, image.content_type
        result = await upload_photo(request.book_id, file_bytes, content_type)
        return str(result["url"])

    async def request_extension(
        self, exchange_id: uuid.UUID, current_user_id: uuid.UUID, body: ExtensionRequestBody
    ) -> ExchangeDetail:
        request, next_status = await self._load_for_transition(
            exchange_id, current_user_id, ExchangeAction.request_extension
        )
        if request.extension_status is ExtensionStatus.pending:
            raise ExchangeError("EXTENSION_ALREADY_PENDING", 409)
        request.status = next_status
        request.extension_requested_days = body.days
        request.extension_status = ExtensionStatus.pending
        request.updated_at = datetime.now(UTC)
        await self.session.commit()
        await self._send_system_message(
            exchange_id,
            "extension_requested",
            f"{body.days} gün süre uzatımı istedi",
            current_user_id,
        )
        return await self._to_detail(request, current_user_id)

    async def respond_extension(
        self, exchange_id: uuid.UUID, current_user_id: uuid.UUID, approve: bool
    ) -> ExchangeDetail:
        action = ExchangeAction.approve_extension if approve else ExchangeAction.reject_extension
        request, next_status = await self._load_for_transition(exchange_id, current_user_id, action)
        if request.extension_status is not ExtensionStatus.pending:
            raise ExchangeError("NO_EXTENSION_PENDING", 409)
        now = datetime.now(UTC)
        if approve:
            base = request.due_at or now
            request.due_at = base + timedelta(days=request.extension_requested_days or 0)
            request.extension_status = ExtensionStatus.approved
        else:
            request.extension_status = ExtensionStatus.rejected
        request.extension_requested_days = None
        request.status = next_status
        request.updated_at = now
        await self.session.commit()
        await self._send_system_message(
            exchange_id,
            "extension_approved" if approve else "extension_rejected",
            "Süre uzatımını onayladı" if approve else "Süre uzatımını reddetti",
            current_user_id,
        )
        return await self._to_detail(request, current_user_id)

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
        await self._send_system_message(
            exchange_id,
            "meetup_proposed",
            f"Buluşma önerdi: {primary.place_name}",
            current_user_id,
        )
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
        await self._send_system_message(
            exchange_id,
            "meetup_accepted",
            f"Buluşmayı kabul etti: {meetup.place_name}",
            current_user_id,
        )
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
            items=[BlockedUserView(user_id=b.blocked_id, created_at=b.created_at) for b in blocks]
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
        other_books, _ = await self.books_repo.list_by_owner(other_user_id, None, 1)
        if other_books:
            other_lat, other_lng = other_books[0].location
            lat = (lat + other_lat) / 2
            lng = (lng + other_lng) / 2

        return await places_service.nearby(self.redis, lat, lng)

    # -----------------------------------------------------------------------
    # B20: Book Retirement Flow
    # -----------------------------------------------------------------------

    async def retire_book(
        self, exchange_id: uuid.UUID, current_user_id: uuid.UUID
    ) -> ExchangeDetail:
        """Mark a traded book as retired by the user who received it in trade."""
        request = await self.repo.get_for_update(exchange_id)
        participants = (request.requested_by, request.requested_to) if request else ()
        if request is None or current_user_id not in participants:
            raise ExchangeError("NOT_FOUND", 404)
        if request.status is not ExchangeStatus.completed:
            raise ExchangeError("NOT_COMPLETED", 409)
        if request.mode is not ExchangeMode.trade:
            raise ExchangeError("NOT_A_TRADE", 409)
        # The receiver of the book in a trade is the requester.
        if current_user_id != request.requested_by:
            raise ExchangeError("WRONG_ACTOR", 409)
        if request.retired_at is not None:
            raise ExchangeError("ALREADY_RETIRED", 409)

        book_row = await self.books_repo.get_by_id(request.book_id)
        if book_row is not None:
            await self.books_repo.update(book_row.book, {"is_available": False})

        now = datetime.now(UTC)
        request.retired_by = current_user_id
        request.retired_at = now
        request.updated_at = now
        await self.session.commit()
        await self._send_system_message(
            exchange_id, "book_retired", "Kitabı rafına kaldırdı", current_user_id
        )
        return await self._to_detail(request, current_user_id)

    # -----------------------------------------------------------------------
    # B21: Meetup Reschedule
    # -----------------------------------------------------------------------

    async def reschedule_meetup(
        self, exchange_id: uuid.UUID, current_user_id: uuid.UUID, body: MeetupProposeRequest
    ) -> ExchangeDetail:
        """Reschedule an already-confirmed meetup, reusing the existing meetup row."""
        request = await self.repo.get_for_update(exchange_id)
        participants = (request.requested_by, request.requested_to) if request else ()
        if request is None or current_user_id not in participants:
            raise ExchangeError("NOT_FOUND", 404)
        if request.status is not ExchangeStatus.meetup_confirmed:
            raise ExchangeError("NOT_CONFIRMED", 409)
        existing = await self.repo.get_meetup(request.id)
        if existing is None:
            raise ExchangeError("NOT_FOUND", 404)

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

        # Back to proposed so the counterpart must re-confirm the new time/place.
        request.status = ExchangeStatus.meetup_proposed
        request.updated_at = datetime.now(UTC)
        await self.session.commit()
        return await self._to_detail(request, current_user_id)

    # -----------------------------------------------------------------------
    # B24: Reading Buddy Matching
    # -----------------------------------------------------------------------

    async def create_reading_buddy(
        self, exchange_id: uuid.UUID, current_user_id: uuid.UUID
    ) -> ReadingBuddyView:
        """Invite the exchange counterpart to become a reading buddy."""
        request = await self.repo.get(exchange_id)
        participants = (request.requested_by, request.requested_to) if request else ()
        if request is None or current_user_id not in participants:
            raise ExchangeError("NOT_FOUND", 404)
        if request.status is not ExchangeStatus.completed:
            raise ExchangeError("NOT_COMPLETED", 409)

        buddy_id = (
            request.requested_to
            if current_user_id == request.requested_by
            else request.requested_by
        )

        existing = await self.session.execute(
            select(ReadingBuddy).where(ReadingBuddy.exchange_id == request.id)
        )
        if existing.scalar_one_or_none() is not None:
            raise ExchangeError("READING_BUDDY_EXISTS", 409)

        buddy = ReadingBuddy(
            exchange_id=request.id,
            user_id=current_user_id,
            buddy_id=buddy_id,
            book_id=request.book_id,
            status=ReadingBuddyStatus.pending,
        )
        self.session.add(buddy)
        await self.session.flush()
        await self.session.refresh(buddy)
        await self.session.commit()
        await self._send_system_message(
            exchange_id,
            "reading_buddy_requested",
            "Okuma arkadaşı olmayı teklif etti",
            current_user_id,
        )
        return self._reading_buddy_view(buddy)

    async def accept_reading_buddy(
        self, exchange_id: uuid.UUID, current_user_id: uuid.UUID, accept: bool
    ) -> ReadingBuddyView:
        """Accept or decline a pending reading-buddy invitation.

        On accept, the existing exchange chat is reused for the reading-buddy
        conversation (the chat module derives participants from the exchange).
        """
        result = await self.session.execute(
            select(ReadingBuddy).where(ReadingBuddy.exchange_id == exchange_id)
        )
        buddy = result.scalar_one_or_none()
        if buddy is None:
            raise ExchangeError("NOT_FOUND", 404)
        request = await self.repo.get(exchange_id)
        participants = (request.requested_by, request.requested_to) if request else ()
        if request is None or current_user_id not in participants:
            raise ExchangeError("NOT_FOUND", 404)
        if current_user_id != buddy.buddy_id:
            raise ExchangeError("WRONG_ACTOR", 409)
        if buddy.status is not ReadingBuddyStatus.pending:
            raise ExchangeError("NO_PENDING_BUDDY", 409)

        if accept:
            chat_result = await self.session.execute(
                select(Chat).where(Chat.exchange_request_id == exchange_id)
            )
            chat = chat_result.scalar_one_or_none()
            if chat is not None:
                buddy.chat_id = chat.id
            buddy.status = ReadingBuddyStatus.accepted
        else:
            buddy.status = ReadingBuddyStatus.declined

        await self.session.commit()
        await self.session.refresh(buddy)
        await self._send_system_message(
            exchange_id,
            "reading_buddy_accepted" if accept else "reading_buddy_declined",
            "Okuma arkadaşlığını kabul etti" if accept else "Okuma arkadaşlığını reddetti",
            current_user_id,
        )
        return self._reading_buddy_view(buddy)

    # ------------------------------------------------------------------
    # Nerdeyim Modu — live location sharing
    # ------------------------------------------------------------------
    LOCATION_TTL = 300  # 5 minutes

    @staticmethod
    def _apply_precision(latitude: float, longitude: float, precision: str) -> tuple[float, float]:
        """Approximate precision rounds to ~1.1km grid so the exact address isn't exposed."""
        if precision == "approximate":
            return round(latitude, 2), round(longitude, 2)
        return latitude, longitude

    @staticmethod
    def _partner_id(exchange: ExchangeRequest, user_id: uuid.UUID) -> uuid.UUID:
        return exchange.requested_to if user_id == exchange.requested_by else exchange.requested_by

    async def update_location(
        self,
        exchange_id: uuid.UUID,
        user_id: uuid.UUID,
        latitude: float,
        longitude: float,
        precision: str = "exact",
    ) -> None:
        """Store this user's current location in Redis and push it to the partner over WebSocket."""
        exchange = await self._get_validated_exchange(exchange_id, user_id)
        lat, lng = self._apply_precision(latitude, longitude, precision)
        ts = datetime.now(UTC).isoformat()

        key = f"loc:{exchange_id}:{user_id}"
        is_first_update = await self.redis.exists(key) == 0
        payload = json.dumps({"lat": lat, "lng": lng, "ts": ts, "precision": precision})
        await self.redis.set(key, payload, ex=self.LOCATION_TTL)

        from app.modules.chat.service import ConnectionManager

        partner_id = self._partner_id(exchange, user_id)
        await ConnectionManager.send_to_user(
            partner_id,
            {
                "type": "location_update",
                "exchange_id": str(exchange_id),
                "user_id": str(user_id),
                "latitude": lat,
                "longitude": lng,
                "precision": precision,
                "updated_at": ts,
            },
        )

        # Notify the partner that sharing just started — a raw WS push is a
        # no-op if their app isn't open/connected, so this is the only signal
        # they'll get if MeetBook is backgrounded or closed.
        if is_first_update:
            await self._notify_location_started(exchange_id, user_id, partner_id)

    async def _notify_location_started(
        self, exchange_id: uuid.UUID, sharer_id: uuid.UUID, partner_id: uuid.UUID
    ) -> None:
        from app.modules.notifications.service import NotificationService

        sharer = await self.auth_repo.get_user_by_id(sharer_id)
        sharer_name = sharer.name if sharer else "Takas ortağın"

        await NotificationService(self.session).notify(
            partner_id,
            "location_started",
            {
                "exchange_id": str(exchange_id),
                "sharer_id": str(sharer_id),
                "sharer_name": sharer_name,
            },
            title="Nerdeyim Modu",
            body=f"{sharer_name} canlı konumunu paylaşmaya başladı",
        )
        await self.session.commit()

    async def stop_location_sharing(self, exchange_id: uuid.UUID, user_id: uuid.UUID) -> None:
        """Explicitly stop sharing — clears the Redis key immediately instead of waiting for TTL,
        and notifies the partner in real time so their UI updates instantly."""
        exchange = await self._get_validated_exchange(exchange_id, user_id)
        key = f"loc:{exchange_id}:{user_id}"
        await self.redis.delete(key)

        from app.modules.chat.service import ConnectionManager

        partner_id = self._partner_id(exchange, user_id)
        await ConnectionManager.send_to_user(
            partner_id,
            {
                "type": "location_stopped",
                "exchange_id": str(exchange_id),
                "user_id": str(user_id),
            },
        )

    async def get_partner_location(
        self, exchange_id: uuid.UUID, user_id: uuid.UUID
    ) -> dict[str, Any] | None:
        """Get the other participant's last known location from Redis."""
        exchange = await self._get_validated_exchange(exchange_id, user_id)
        partner_id = self._partner_id(exchange, user_id)
        key = f"loc:{exchange_id}:{partner_id}"
        raw = await self.redis.get(key)
        if raw is None:
            return None
        data = json.loads(raw)
        return {
            "latitude": data["lat"],
            "longitude": data["lng"],
            "updated_at": data["ts"],
            "precision": data.get("precision", "exact"),
        }

    async def get_location_status(
        self, exchange_id: uuid.UUID, user_id: uuid.UUID
    ) -> dict[str, Any]:
        """Full sharing state for both participants in one call.

        The Redis keys ARE the sharing state (written by update_location with
        a TTL, cleared by stop_location_sharing) — so this endpoint is the
        single source of truth clients should render from, instead of each
        device deriving 'am I sharing' from its own fragile local GPS
        subscription state.
        """
        exchange = await self._get_validated_exchange(exchange_id, user_id)
        partner_id = self._partner_id(exchange, user_id)
        my_raw = await self.redis.get(f"loc:{exchange_id}:{user_id}")
        partner_raw = await self.redis.get(f"loc:{exchange_id}:{partner_id}")

        partner_location = None
        if partner_raw is not None:
            data = json.loads(partner_raw)
            partner_location = {
                "latitude": data["lat"],
                "longitude": data["lng"],
                "updated_at": data["ts"],
                "precision": data.get("precision", "exact"),
            }
        return {
            "me_sharing": my_raw is not None,
            "partner_sharing": partner_raw is not None,
            "partner_location": partner_location,
        }

    async def _get_validated_exchange(
        self, exchange_id: uuid.UUID, user_id: uuid.UUID
    ) -> ExchangeRequest:
        """Fetch exchange and verify user is a participant and meetup is confirmed."""
        request = await self.repo.get(exchange_id)
        if request is None:
            raise ExchangeError("NOT_FOUND", 404)
        if user_id not in (request.requested_by, request.requested_to):
            raise ExchangeError("NOT_FOUND", 404)
        if request.status != ExchangeStatus.meetup_confirmed:
            raise ExchangeError("WRONG_STATUS", 409)
        return request
