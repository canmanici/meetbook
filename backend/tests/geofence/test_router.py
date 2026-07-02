"""Tests for the geofence alert endpoints."""

import uuid

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.geo import make_point
from app.modules.auth.models import User
from app.modules.books.models import Book, BookCategory, BookCondition
from app.modules.geofence.models import GeofenceAlert
from app.modules.wishlist.models import WishlistItem

ISTANBUL = (41.0082, 28.9784)


async def _register(client: httpx.AsyncClient) -> dict:
    email = f"gf_test_{uuid.uuid7().hex[:12]}@example.com"
    resp = await client.post(
        "/api/v1/auth/register",
        json={
            "email": email,
            "password": "securepass123",
            "name": "Test User",
            "kvkk_consent": True,
        },
    )
    body = resp.json()
    return {
        "user_id": body["user_id"],
        "headers": {"Authorization": f"Bearer {body['access_token']}"},
    }


@pytest.mark.asyncio
async def test_list_alerts_empty(client: httpx.AsyncClient) -> None:
    user = await _register(client)
    resp = await client.get("/api/v1/geofence/alerts", headers=user["headers"])
    assert resp.status_code == 200
    assert resp.json() == {"items": []}


@pytest.mark.asyncio
async def test_list_alerts_with_unread(
    client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    user = await _register(client)
    uid = uuid.UUID(user["user_id"])

    point = make_point(*ISTANBUL)
    book = Book(
        owner_id=uid,
        title="Test Book",
        category=BookCategory.fiction,
        condition=BookCondition.good,
        location=point,
        public_location=point,
    )
    db_session.add(book)
    wish = WishlistItem(user_id=uid, isbn="9789750738948", title="Wished")
    db_session.add(wish)
    await db_session.flush()

    alert = GeofenceAlert(
        user_id=uid,
        wishlist_item_id=wish.id,
        book_id=book.id,
    )
    db_session.add(alert)
    await db_session.commit()

    resp = await client.get("/api/v1/geofence/alerts", headers=user["headers"])
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["items"]) == 1
    assert body["items"][0]["wishlist_item_id"] == str(wish.id)
    assert body["items"][0]["book_id"] == str(book.id)


@pytest.mark.asyncio
async def test_mark_alert_read(
    client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    user = await _register(client)
    uid = uuid.UUID(user["user_id"])

    point = make_point(*ISTANBUL)
    book = Book(
        owner_id=uid,
        title="Test Book",
        category=BookCategory.fiction,
        condition=BookCondition.good,
        location=point,
        public_location=point,
    )
    db_session.add(book)
    wish = WishlistItem(user_id=uid, isbn="9789750738948", title="Wished")
    db_session.add(wish)
    await db_session.flush()

    alert = GeofenceAlert(
        user_id=uid,
        wishlist_item_id=wish.id,
        book_id=book.id,
    )
    db_session.add(alert)
    await db_session.commit()

    resp = await client.patch(
        f"/api/v1/geofence/alerts/{alert.id}/read",
        headers=user["headers"],
    )
    assert resp.status_code == 200
    assert resp.json()["read_at"] is not None

    # After marking read, should not appear in unread list
    resp = await client.get("/api/v1/geofence/alerts", headers=user["headers"])
    assert resp.json() == {"items": []}


@pytest.mark.asyncio
async def test_mark_alert_read_nonexistent(client: httpx.AsyncClient) -> None:
    user = await _register(client)
    fake_id = uuid.uuid7()
    resp = await client.patch(
        f"/api/v1/geofence/alerts/{fake_id}/read",
        headers=user["headers"],
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_list_alerts_requires_auth(client: httpx.AsyncClient) -> None:
    resp = await client.get("/api/v1/geofence/alerts")
    assert resp.status_code == 401
