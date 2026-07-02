import uuid

import httpx
import pytest


@pytest.mark.asyncio
async def test_detail_visible_to_participants(
    client: httpx.AsyncClient, register_user, create_book
) -> None:
    owner = await register_user("detail_owner@example.com", "Owner")
    requester = await register_user("detail_requester@example.com", "Requester")
    book_id = await create_book(owner["headers"])

    create_resp = await client.post(
        "/api/v1/exchanges",
        json={"book_id": book_id, "initial_message": "Hi"},
        headers=requester["headers"],
    )
    exchange_id = create_resp.json()["id"]

    for actor in (owner, requester):
        resp = await client.get(f"/api/v1/exchanges/{exchange_id}", headers=actor["headers"])
        assert resp.status_code == 200
        assert resp.json()["id"] == exchange_id


@pytest.mark.asyncio
async def test_detail_hidden_from_non_participants(
    client: httpx.AsyncClient, register_user, create_book
) -> None:
    owner = await register_user("detail_owner2@example.com", "Owner")
    requester = await register_user("detail_requester2@example.com", "Requester")
    stranger = await register_user("detail_stranger@example.com", "Stranger")
    book_id = await create_book(owner["headers"])

    create_resp = await client.post(
        "/api/v1/exchanges",
        json={"book_id": book_id, "initial_message": "Hi"},
        headers=requester["headers"],
    )
    exchange_id = create_resp.json()["id"]

    resp = await client.get(f"/api/v1/exchanges/{exchange_id}", headers=stranger["headers"])
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_detail_nonexistent_returns_404(client: httpx.AsyncClient, register_user) -> None:
    user = await register_user("detail_404@example.com", "User")

    resp = await client.get(f"/api/v1/exchanges/{uuid.uuid7()}", headers=user["headers"])
    assert resp.status_code == 404
