"""Tests for the geofence matcher worker."""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.geo import make_point
from app.modules.auth.models import User
from app.modules.books.models import Book, BookCategory, BookCondition
from app.modules.geofence.models import GeofenceAlert
from app.modules.wishlist.models import WishlistItem
from app.workers.geofence_matcher import run_geofence_matcher

ISTANBUL = (41.0082, 28.9784)
IZMIR = (38.4192, 27.1287)  # ~330 km from Istanbul, outside a 10 km radius
NEARBY = (41.0100, 28.9800)  # ~200 m from Istanbul, well within 10 km


async def _make_user(session: AsyncSession, name: str, radius: int = 10) -> User:
    user = User(email=f"{name}@example.com", name=name)
    user.geofence_radius_km = radius
    session.add(user)
    await session.flush()
    return user


async def _make_book(
    session: AsyncSession, owner_id: uuid.UUID, lat: float, lng: float, isbn: str = "9789750738948"
) -> Book:
    point = make_point(lat, lng)
    book = Book(
        owner_id=owner_id,
        title="Test Book",
        isbn=isbn,
        category=BookCategory.fiction,
        condition=BookCondition.good,
        location=point,
        public_location=point,
    )
    session.add(book)
    await session.flush()
    return book


async def _make_wishlist_item(
    session: AsyncSession, user_id: uuid.UUID, isbn: str = "9789750738948"
) -> WishlistItem:
    item = WishlistItem(user_id=user_id, isbn=isbn, title="Wished Book")
    session.add(item)
    await session.flush()
    return item


@pytest.mark.asyncio
async def test_worker_creates_alert_for_nearby_match(db_session: AsyncSession) -> None:
    owner = await _make_user(db_session, "owner")
    seeker = await _make_user(db_session, "seeker")
    await _make_book(db_session, owner.id, *NEARBY)
    await _make_book(db_session, seeker.id, *ISTANBUL)  # position proxy
    wish = await _make_wishlist_item(db_session, seeker.id)
    await db_session.commit()

    count = await run_geofence_matcher(db_session)
    assert count == 1

    alerts = (await db_session.execute(select(GeofenceAlert))).scalars().all()
    assert len(alerts) == 1
    assert alerts[0].user_id == seeker.id
    assert alerts[0].wishlist_item_id == wish.id


@pytest.mark.asyncio
async def test_worker_skips_out_of_range(db_session: AsyncSession) -> None:
    owner = await _make_user(db_session, "owner")
    seeker = await _make_user(db_session, "seeker")
    await _make_book(db_session, owner.id, *IZMIR)  # ~330 km away
    await _make_book(db_session, seeker.id, *ISTANBUL)
    await _make_wishlist_item(db_session, seeker.id)
    await db_session.commit()

    count = await run_geofence_matcher(db_session)
    assert count == 0


@pytest.mark.asyncio
async def test_worker_skips_own_books(db_session: AsyncSession) -> None:
    owner = await _make_user(db_session, "owner")
    await _make_book(db_session, owner.id, *NEARBY)
    await _make_wishlist_item(db_session, owner.id)
    await db_session.commit()

    count = await run_geofence_matcher(db_session)
    assert count == 0


@pytest.mark.asyncio
async def test_worker_idempotent_skips_existing_alert(db_session: AsyncSession) -> None:
    owner = await _make_user(db_session, "owner")
    seeker = await _make_user(db_session, "seeker")
    book = await _make_book(db_session, owner.id, *NEARBY)
    await _make_book(db_session, seeker.id, *ISTANBUL)
    wish = await _make_wishlist_item(db_session, seeker.id)
    await db_session.commit()

    count = await run_geofence_matcher(db_session)
    assert count == 1

    count = await run_geofence_matcher(db_session)
    assert count == 0  # Second run should not create duplicate


@pytest.mark.asyncio
async def test_worker_skips_seeker_without_book(db_session: AsyncSession) -> None:
    owner = await _make_user(db_session, "owner")
    seeker = await _make_user(db_session, "seeker")
    await _make_book(db_session, owner.id, *NEARBY)
    await _make_wishlist_item(db_session, seeker.id)
    await db_session.commit()

    count = await run_geofence_matcher(db_session)
    assert count == 0


@pytest.mark.asyncio
async def test_worker_skips_wishlist_without_isbn(db_session: AsyncSession) -> None:
    owner = await _make_user(db_session, "owner")
    seeker = await _make_user(db_session, "seeker")
    await _make_book(db_session, owner.id, *NEARBY)
    await _make_book(db_session, seeker.id, *ISTANBUL)
    item = WishlistItem(user_id=seeker.id, isbn="", title="No ISBN Wish")
    db_session.add(item)
    await db_session.commit()

    count = await run_geofence_matcher(db_session)
    assert count == 0


@pytest.mark.asyncio
async def test_worker_skips_different_isbn(db_session: AsyncSession) -> None:
    owner = await _make_user(db_session, "owner")
    seeker = await _make_user(db_session, "seeker")
    await _make_book(db_session, owner.id, *NEARBY, isbn="1111111111111")
    await _make_book(db_session, seeker.id, *ISTANBUL, isbn="2222222222222")
    await _make_wishlist_item(db_session, seeker.id, isbn="2222222222222")
    await db_session.commit()

    count = await run_geofence_matcher(db_session)
    assert count == 0
