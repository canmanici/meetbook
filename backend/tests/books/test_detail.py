import uuid

import httpx
import pytest

from tests.books.conftest import VALID_BOOK_PAYLOAD


@pytest.mark.asyncio
async def test_get_own_book_includes_location(
    client: httpx.AsyncClient, register_user
) -> None:
    owner = await register_user("detail_owner@example.com", "Owner")

    create_resp = await client.post(
        "/api/v1/books", json=VALID_BOOK_PAYLOAD, headers=owner["headers"]
    )
    book_id = create_resp.json()["id"]

    resp = await client.get(f"/api/v1/books/{book_id}", headers=owner["headers"])
    assert resp.status_code == 200
    body = resp.json()
    assert body["location"] == {"lat": 41.0082, "lng": 28.9784}
    assert body["public_location"] == {"lat": 41.01, "lng": 28.98}


@pytest.mark.asyncio
async def test_get_other_users_book_omits_location_field(
    client: httpx.AsyncClient, register_user
) -> None:
    owner = await register_user("detail_owner2@example.com", "Owner")
    other = await register_user("detail_other@example.com", "Other")

    create_resp = await client.post(
        "/api/v1/books", json=VALID_BOOK_PAYLOAD, headers=owner["headers"]
    )
    book_id = create_resp.json()["id"]

    resp = await client.get(f"/api/v1/books/{book_id}", headers=other["headers"])
    assert resp.status_code == 200
    body = resp.json()
    assert "location" not in body
    assert body["public_location"] == {"lat": 41.01, "lng": 28.98}


@pytest.mark.asyncio
async def test_get_nonexistent_book_returns_404(
    client: httpx.AsyncClient, register_user
) -> None:
    owner = await register_user("detail_404@example.com", "Owner")

    resp = await client.get(f"/api/v1/books/{uuid.uuid4()}", headers=owner["headers"])
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_get_soft_deleted_book_returns_404(
    client: httpx.AsyncClient, register_user
) -> None:
    owner = await register_user("detail_deleted@example.com", "Owner")

    create_resp = await client.post(
        "/api/v1/books", json=VALID_BOOK_PAYLOAD, headers=owner["headers"]
    )
    book_id = create_resp.json()["id"]

    await client.delete(f"/api/v1/books/{book_id}", headers=owner["headers"])

    resp = await client.get(f"/api/v1/books/{book_id}", headers=owner["headers"])
    assert resp.status_code == 404
