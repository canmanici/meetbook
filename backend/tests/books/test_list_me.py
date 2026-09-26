import httpx
import pytest

from tests.books.conftest import VALID_BOOK_PAYLOAD


@pytest.mark.asyncio
async def test_list_me_returns_own_books(client: httpx.AsyncClient, register_user) -> None:
    owner = await register_user("list_owner@example.com", "Owner")

    for title in ("Book One", "Book Two"):
        await client.post(
            "/api/v1/books",
            json={**VALID_BOOK_PAYLOAD, "title": title},
            headers=owner["headers"],
        )

    resp = await client.get("/api/v1/books/me", headers=owner["headers"])
    assert resp.status_code == 200
    body = resp.json()
    titles = {item["title"] for item in body["items"]}
    assert titles == {"Book One", "Book Two"}
    # Owner's own list includes true location
    assert "location" in body["items"][0]


@pytest.mark.asyncio
async def test_list_me_excludes_other_users_books(client: httpx.AsyncClient, register_user) -> None:
    owner_a = await register_user("list_a@example.com", "Owner A")
    owner_b = await register_user("list_b@example.com", "Owner B")

    await client.post(
        "/api/v1/books",
        json={**VALID_BOOK_PAYLOAD, "title": "Owner A's Book"},
        headers=owner_a["headers"],
    )
    await client.post(
        "/api/v1/books",
        json={**VALID_BOOK_PAYLOAD, "title": "Owner B's Book"},
        headers=owner_b["headers"],
    )

    resp = await client.get("/api/v1/books/me", headers=owner_a["headers"])
    titles = {item["title"] for item in resp.json()["items"]}
    assert titles == {"Owner A's Book"}


@pytest.mark.asyncio
async def test_list_me_excludes_soft_deleted(client: httpx.AsyncClient, register_user) -> None:
    owner = await register_user("list_deleted@example.com", "Owner")

    create_resp = await client.post(
        "/api/v1/books",
        json={**VALID_BOOK_PAYLOAD, "title": "To Be Deleted"},
        headers=owner["headers"],
    )
    book_id = create_resp.json()["id"]

    del_resp = await client.delete(f"/api/v1/books/{book_id}", headers=owner["headers"])
    assert del_resp.status_code == 204

    resp = await client.get("/api/v1/books/me", headers=owner["headers"])
    titles = [item["title"] for item in resp.json()["items"]]
    assert "To Be Deleted" not in titles


@pytest.mark.asyncio
async def test_list_me_requires_auth(client: httpx.AsyncClient) -> None:
    resp = await client.get("/api/v1/books/me")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_list_me_pagination(client: httpx.AsyncClient, register_user) -> None:
    owner = await register_user("list_paginate@example.com", "Owner")

    for i in range(3):
        await client.post(
            "/api/v1/books",
            json={**VALID_BOOK_PAYLOAD, "title": f"Book {i}"},
            headers=owner["headers"],
        )

    first_page = await client.get("/api/v1/books/me", params={"limit": 2}, headers=owner["headers"])
    first_body = first_page.json()
    assert len(first_body["items"]) == 2
    assert first_body["next_cursor"] is not None

    second_page = await client.get(
        "/api/v1/books/me",
        params={"limit": 2, "cursor": first_body["next_cursor"]},
        headers=owner["headers"],
    )
    second_body = second_page.json()
    assert len(second_body["items"]) == 1

    first_ids = {item["id"] for item in first_body["items"]}
    second_ids = {item["id"] for item in second_body["items"]}
    assert first_ids.isdisjoint(second_ids)
