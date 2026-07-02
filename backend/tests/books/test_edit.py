import uuid

import httpx
import pytest

from tests.books.conftest import OUTSIDE_TURKEY, VALID_BOOK_PAYLOAD


@pytest.mark.asyncio
async def test_patch_owner_updates_fields(client: httpx.AsyncClient, register_user) -> None:
    owner = await register_user("edit_owner@example.com", "Owner")

    create_resp = await client.post(
        "/api/v1/books", json=VALID_BOOK_PAYLOAD, headers=owner["headers"]
    )
    book_id = create_resp.json()["id"]

    resp = await client.patch(
        f"/api/v1/books/{book_id}",
        json={"title": "Updated Title", "is_available": False},
        headers=owner["headers"],
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["title"] == "Updated Title"
    assert body["is_available"] is False
    # Untouched fields stay as they were
    assert body["author"] == VALID_BOOK_PAYLOAD["author"]


@pytest.mark.asyncio
async def test_patch_recomputes_public_location(
    client: httpx.AsyncClient, register_user
) -> None:
    owner = await register_user("edit_location@example.com", "Owner")

    create_resp = await client.post(
        "/api/v1/books", json=VALID_BOOK_PAYLOAD, headers=owner["headers"]
    )
    book_id = create_resp.json()["id"]

    new_location = {"lat": 39.9334, "lng": 32.8597}  # Ankara
    resp = await client.patch(
        f"/api/v1/books/{book_id}",
        json={"location": new_location},
        headers=owner["headers"],
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["location"] == new_location
    assert body["public_location"] == {"lat": 39.93, "lng": 32.86}


@pytest.mark.asyncio
async def test_patch_location_outside_turkey_rejected(
    client: httpx.AsyncClient, register_user
) -> None:
    owner = await register_user("edit_bbox@example.com", "Owner")

    create_resp = await client.post(
        "/api/v1/books", json=VALID_BOOK_PAYLOAD, headers=owner["headers"]
    )
    book_id = create_resp.json()["id"]

    resp = await client.patch(
        f"/api/v1/books/{book_id}",
        json={"location": OUTSIDE_TURKEY},
        headers=owner["headers"],
    )
    assert resp.status_code == 400
    assert resp.json()["detail"] == "LOCATION_OUTSIDE_TURKEY"


@pytest.mark.asyncio
async def test_patch_non_owner_returns_404(client: httpx.AsyncClient, register_user) -> None:
    owner = await register_user("edit_owner3@example.com", "Owner")
    other = await register_user("edit_other@example.com", "Other")

    create_resp = await client.post(
        "/api/v1/books", json=VALID_BOOK_PAYLOAD, headers=owner["headers"]
    )
    book_id = create_resp.json()["id"]

    resp = await client.patch(
        f"/api/v1/books/{book_id}",
        json={"title": "Hijacked"},
        headers=other["headers"],
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_patch_nonexistent_book_returns_404(
    client: httpx.AsyncClient, register_user
) -> None:
    owner = await register_user("edit_404@example.com", "Owner")

    resp = await client.patch(
        f"/api/v1/books/{uuid.uuid7()}",
        json={"title": "Nope"},
        headers=owner["headers"],
    )
    assert resp.status_code == 404
