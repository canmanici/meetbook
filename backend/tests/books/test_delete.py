import uuid

import httpx
import pytest

from tests.books.conftest import VALID_BOOK_PAYLOAD


@pytest.mark.asyncio
async def test_delete_owner_success(client: httpx.AsyncClient, register_user) -> None:
    owner = await register_user("delete_owner@example.com", "Owner")

    create_resp = await client.post(
        "/api/v1/books", json=VALID_BOOK_PAYLOAD, headers=owner["headers"]
    )
    book_id = create_resp.json()["id"]

    resp = await client.delete(f"/api/v1/books/{book_id}", headers=owner["headers"])
    assert resp.status_code == 204

    get_resp = await client.get(f"/api/v1/books/{book_id}", headers=owner["headers"])
    assert get_resp.status_code == 404


@pytest.mark.asyncio
async def test_delete_non_owner_returns_404(client: httpx.AsyncClient, register_user) -> None:
    owner = await register_user("delete_owner2@example.com", "Owner")
    other = await register_user("delete_other@example.com", "Other")

    create_resp = await client.post(
        "/api/v1/books", json=VALID_BOOK_PAYLOAD, headers=owner["headers"]
    )
    book_id = create_resp.json()["id"]

    resp = await client.delete(f"/api/v1/books/{book_id}", headers=other["headers"])
    assert resp.status_code == 404

    # Book still accessible to its real owner
    get_resp = await client.get(f"/api/v1/books/{book_id}", headers=owner["headers"])
    assert get_resp.status_code == 200


@pytest.mark.asyncio
async def test_delete_already_deleted_returns_404(client: httpx.AsyncClient, register_user) -> None:
    owner = await register_user("delete_twice@example.com", "Owner")

    create_resp = await client.post(
        "/api/v1/books", json=VALID_BOOK_PAYLOAD, headers=owner["headers"]
    )
    book_id = create_resp.json()["id"]

    first = await client.delete(f"/api/v1/books/{book_id}", headers=owner["headers"])
    assert first.status_code == 204

    second = await client.delete(f"/api/v1/books/{book_id}", headers=owner["headers"])
    assert second.status_code == 404


@pytest.mark.asyncio
async def test_delete_nonexistent_book_returns_404(
    client: httpx.AsyncClient, register_user
) -> None:
    owner = await register_user("delete_404@example.com", "Owner")

    resp = await client.delete(f"/api/v1/books/{uuid.uuid7()}", headers=owner["headers"])
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_delete_with_active_exchange_requires_force(
    client: httpx.AsyncClient, register_user
) -> None:
    owner = await register_user("delete_active_exchange_owner@example.com", "Owner")
    requester = await register_user("delete_active_exchange_requester@example.com", "Requester")

    create_resp = await client.post(
        "/api/v1/books", json=VALID_BOOK_PAYLOAD, headers=owner["headers"]
    )
    book_id = create_resp.json()["id"]

    exchange_resp = await client.post(
        "/api/v1/exchanges",
        json={"book_id": book_id, "initial_message": "Hi"},
        headers=requester["headers"],
    )
    assert exchange_resp.status_code == 201
    exchange_id = exchange_resp.json()["id"]

    # Normal delete without force -> 409 (active exchange)
    normal_resp = await client.delete(f"/api/v1/books/{book_id}", headers=owner["headers"])
    assert normal_resp.status_code == 409
    assert normal_resp.json()["detail"] == "EXCHANGE_ACTIVE"

    # Force delete -> succeeds, exchange auto-cancelled
    delete_resp = await client.delete(
        f"/api/v1/books/{book_id}?force=true",
        headers=owner["headers"],
    )
    assert delete_resp.status_code == 204

    # Verify the exchange request was cancelled
    get_resp = await client.get(f"/api/v1/exchanges/{exchange_id}", headers=requester["headers"])
    assert get_resp.status_code == 200
    assert get_resp.json()["status"] == "cancelled"
