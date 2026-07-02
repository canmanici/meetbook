import uuid

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.exchanges.models import Block


@pytest.mark.asyncio
async def test_create_success(client: httpx.AsyncClient, register_user, create_book) -> None:
    owner = await register_user("create_owner@example.com", "Owner")
    requester = await register_user("create_requester@example.com", "Requester")
    book_id = await create_book(owner["headers"])

    resp = await client.post(
        "/api/v1/exchanges",
        json={"book_id": book_id, "initial_message": "Merhaba, ilgileniyorum"},
        headers=requester["headers"],
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["status"] == "pending"
    assert body["requested_by"] == requester["user_id"]
    assert body["requested_to"] == owner["user_id"]
    assert body["book"]["id"] == book_id
    assert body["counterpart"]["id"] == owner["user_id"]


@pytest.mark.asyncio
async def test_create_book_not_found(client: httpx.AsyncClient, register_user) -> None:
    requester = await register_user("create_404@example.com", "Requester")

    resp = await client.post(
        "/api/v1/exchanges",
        json={"book_id": str(uuid.uuid7()), "initial_message": "Hi"},
        headers=requester["headers"],
    )
    assert resp.status_code == 404
    assert resp.json()["detail"] == "BOOK_NOT_FOUND"


@pytest.mark.asyncio
async def test_create_self_request_rejected(
    client: httpx.AsyncClient, register_user, create_book
) -> None:
    owner = await register_user("create_self@example.com", "Owner")
    book_id = await create_book(owner["headers"])

    resp = await client.post(
        "/api/v1/exchanges",
        json={"book_id": book_id, "initial_message": "Hi"},
        headers=owner["headers"],
    )
    assert resp.status_code == 400
    assert resp.json()["detail"] == "SELF_REQUEST"


@pytest.mark.asyncio
async def test_create_blocked_pair_hidden_as_not_found(
    client: httpx.AsyncClient, register_user, create_book, db_session: AsyncSession
) -> None:
    owner = await register_user("create_blocked_owner@example.com", "Owner")
    requester = await register_user("create_blocked_requester@example.com", "Requester")
    book_id = await create_book(owner["headers"])

    db_session.add(
        Block(blocker_id=uuid.UUID(owner["user_id"]), blocked_id=uuid.UUID(requester["user_id"]))
    )
    await db_session.commit()

    resp = await client.post(
        "/api/v1/exchanges",
        json={"book_id": book_id, "initial_message": "Hi"},
        headers=requester["headers"],
    )
    assert resp.status_code == 404
    assert resp.json()["detail"] == "BOOK_NOT_FOUND"


@pytest.mark.asyncio
async def test_create_book_unavailable_rejected(
    client: httpx.AsyncClient, register_user, create_book
) -> None:
    owner = await register_user("create_unavailable_owner@example.com", "Owner")
    requester = await register_user("create_unavailable_requester@example.com", "Requester")
    book_id = await create_book(owner["headers"])

    patch_resp = await client.patch(
        f"/api/v1/books/{book_id}", json={"is_available": False}, headers=owner["headers"]
    )
    assert patch_resp.status_code == 200

    resp = await client.post(
        "/api/v1/exchanges",
        json={"book_id": book_id, "initial_message": "Hi"},
        headers=requester["headers"],
    )
    assert resp.status_code == 400
    assert resp.json()["detail"] == "BOOK_UNAVAILABLE"


@pytest.mark.asyncio
async def test_create_duplicate_request_rejected(
    client: httpx.AsyncClient, register_user, create_book
) -> None:
    owner = await register_user("create_dup_owner@example.com", "Owner")
    requester = await register_user("create_dup_requester@example.com", "Requester")
    book_id = await create_book(owner["headers"])

    first = await client.post(
        "/api/v1/exchanges",
        json={"book_id": book_id, "initial_message": "Hi"},
        headers=requester["headers"],
    )
    assert first.status_code == 201

    second = await client.post(
        "/api/v1/exchanges",
        json={"book_id": book_id, "initial_message": "Hi again"},
        headers=requester["headers"],
    )
    assert second.status_code == 409
    assert second.json()["detail"] == "DUPLICATE_REQUEST"


@pytest.mark.asyncio
async def test_create_new_account_limit_rejected(
    client: httpx.AsyncClient, register_user, create_book
) -> None:
    requester = await register_user("create_limit_requester@example.com", "Requester")

    owners = []
    book_ids = []
    for i in range(4):
        owner = await register_user(f"create_limit_owner{i}@example.com", f"Owner{i}")
        owners.append(owner)
        book_ids.append(await create_book(owner["headers"]))

    for i in range(3):
        resp = await client.post(
            "/api/v1/exchanges",
            json={"book_id": book_ids[i], "initial_message": "Hi"},
            headers=requester["headers"],
        )
        assert resp.status_code == 201

    resp = await client.post(
        "/api/v1/exchanges",
        json={"book_id": book_ids[3], "initial_message": "Hi"},
        headers=requester["headers"],
    )
    assert resp.status_code == 400
    assert resp.json()["detail"] == "NEW_ACCOUNT_LIMIT"
