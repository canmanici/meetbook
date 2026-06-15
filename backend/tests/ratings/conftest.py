"""Shared helpers for ratings module tests."""

from collections.abc import Awaitable, Callable
from typing import Any

import httpx
import pytest_asyncio

VALID_BOOK_PAYLOAD: dict[str, Any] = {
    "title": "Suç ve Ceza",
    "author": "Dostoyevski",
    "isbn": "9789750738948",
    "description": "Klasik bir roman",
    "category": "fiction",
    "language": "tr",
    "condition": "good",
    "location": {"lat": 41.0082, "lng": 28.9784},
}


@pytest_asyncio.fixture
async def register_user(
    client: httpx.AsyncClient,
) -> Callable[[str, str], Awaitable[dict[str, Any]]]:
    async def _register(email: str = "owner@example.com", name: str = "Owner") -> dict[str, Any]:
        resp = await client.post(
            "/api/v1/auth/register",
            json={
                "email": email,
                "password": "securepass123",
                "name": name,
                "kvkk_consent": True,
            },
        )
        body = resp.json()
        return {
            "user_id": body["user_id"],
            "headers": {"Authorization": f"Bearer {body['access_token']}"},
        }

    return _register


@pytest_asyncio.fixture
async def create_book(
    client: httpx.AsyncClient,
) -> Callable[[dict[str, str]], Awaitable[str]]:
    async def _create(owner_headers: dict[str, str]) -> str:
        resp = await client.post(
            "/api/v1/books", json=VALID_BOOK_PAYLOAD, headers=owner_headers
        )
        return resp.json()["id"]

    return _create


@pytest_asyncio.fixture
async def completed_exchange(
    client: httpx.AsyncClient,
    register_user: Callable[[str, str], Awaitable[dict[str, Any]]],
    create_book: Callable[[dict[str, str]], Awaitable[str]],
) -> Callable[[], Awaitable[dict[str, Any]]]:
    """Drive a fresh exchange all the way to `completed` and return both parties."""

    async def _build() -> dict[str, Any]:
        owner = await register_user("rating_owner@example.com", "Owner")
        requester = await register_user("rating_requester@example.com", "Requester")
        book_id = await create_book(owner["headers"])

        resp = await client.post(
            "/api/v1/exchanges",
            json={"book_id": book_id, "initial_message": "Merhaba"},
            headers=requester["headers"],
        )
        exchange_id = resp.json()["id"]

        await client.post(
            f"/api/v1/exchanges/{exchange_id}/accept", headers=owner["headers"]
        )
        await client.post(
            f"/api/v1/exchanges/{exchange_id}/complete", headers=requester["headers"]
        )
        await client.post(
            f"/api/v1/exchanges/{exchange_id}/confirm-completion", headers=owner["headers"]
        )

        return {"exchange_id": exchange_id, "owner": owner, "requester": requester}

    return _build


@pytest_asyncio.fixture
async def accepted_exchange(
    client: httpx.AsyncClient,
    register_user: Callable[[str, str], Awaitable[dict[str, Any]]],
    create_book: Callable[[dict[str, str]], Awaitable[str]],
) -> Callable[[], Awaitable[dict[str, Any]]]:
    """Build an exchange stuck at `accepted` (not yet completed)."""

    async def _build() -> dict[str, Any]:
        owner = await register_user("rating_owner2@example.com", "Owner2")
        requester = await register_user("rating_requester2@example.com", "Requester2")
        book_id = await create_book(owner["headers"])

        resp = await client.post(
            "/api/v1/exchanges",
            json={"book_id": book_id, "initial_message": "Merhaba"},
            headers=requester["headers"],
        )
        exchange_id = resp.json()["id"]

        await client.post(
            f"/api/v1/exchanges/{exchange_id}/accept", headers=owner["headers"]
        )

        return {"exchange_id": exchange_id, "owner": owner, "requester": requester}

    return _build
