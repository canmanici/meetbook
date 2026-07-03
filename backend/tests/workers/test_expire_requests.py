"""Tests for the hourly exchange-request expiry worker."""

import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.geo import make_point
from app.modules.auth.models import User
from app.modules.books.models import Book, BookCategory, BookCondition
from app.modules.exchanges.models import ExchangeRequest, ExchangeStatus
from app.workers.expire_requests import expire_requests

ISTANBUL = (41.0082, 28.9784)


async def _make_user(session: AsyncSession, name: str) -> User:
    user = User(email=f"{name}@example.com", name=name, username=f"{name.lower()}_{uuid.uuid4().hex[:6]}")
    session.add(user)
    await session.flush()
    return user


async def _make_book(session: AsyncSession, owner_id: uuid.UUID) -> Book:
    point = make_point(*ISTANBUL)
    book = Book(
        owner_id=owner_id,
        title="Test Book",
        category=BookCategory.fiction,
        condition=BookCondition.good,
        location=point,
        public_location=point,
    )
    session.add(book)
    await session.flush()
    return book


async def _make_request(
    session: AsyncSession,
    book_id: uuid.UUID,
    requested_by: uuid.UUID,
    requested_to: uuid.UUID,
    status: ExchangeStatus,
    expires_at: datetime,
) -> ExchangeRequest:
    request = ExchangeRequest(
        book_id=book_id,
        requested_by=requested_by,
        requested_to=requested_to,
        status=status,
        initial_message="Hi",
        expires_at=expires_at,
    )
    session.add(request)
    await session.flush()
    return request


async def test_expires_overdue_pending_and_accepted(db_session: AsyncSession) -> None:
    owner = await _make_user(db_session, "owner")
    requester_a = await _make_user(db_session, "requester_a")
    requester_b = await _make_user(db_session, "requester_b")
    requester_c = await _make_user(db_session, "requester_c")
    requester_d = await _make_user(db_session, "requester_d")
    book = await _make_book(db_session, owner.id)

    now = datetime.now(UTC)
    overdue_pending = await _make_request(
        db_session,
        book.id,
        requester_a.id,
        owner.id,
        ExchangeStatus.pending,
        now - timedelta(days=1),
    )
    overdue_accepted = await _make_request(
        db_session,
        book.id,
        requester_b.id,
        owner.id,
        ExchangeStatus.accepted,
        now - timedelta(days=1),
    )
    not_yet_due = await _make_request(
        db_session,
        book.id,
        requester_c.id,
        owner.id,
        ExchangeStatus.pending,
        now + timedelta(days=1),
    )
    already_completed = await _make_request(
        db_session,
        book.id,
        requester_d.id,
        owner.id,
        ExchangeStatus.completed,
        now - timedelta(days=1),
    )
    await db_session.commit()

    count = await expire_requests(db_session)
    assert count == 2

    await db_session.refresh(overdue_pending)
    await db_session.refresh(overdue_accepted)
    await db_session.refresh(not_yet_due)
    await db_session.refresh(already_completed)

    assert overdue_pending.status == ExchangeStatus.expired
    assert overdue_accepted.status == ExchangeStatus.expired
    assert not_yet_due.status == ExchangeStatus.pending
    assert already_completed.status == ExchangeStatus.completed


async def test_no_overdue_requests_returns_zero(db_session: AsyncSession) -> None:
    owner = await _make_user(db_session, "owner2")
    requester = await _make_user(db_session, "requester2")
    book = await _make_book(db_session, owner.id)

    await _make_request(
        db_session,
        book.id,
        requester.id,
        owner.id,
        ExchangeStatus.pending,
        datetime.now(UTC) + timedelta(days=1),
    )
    await db_session.commit()

    count = await expire_requests(db_session)
    assert count == 0
