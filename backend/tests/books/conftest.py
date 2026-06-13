"""Shared helpers for books module tests."""

from collections.abc import Awaitable, Callable
from typing import Any

import httpx
import pytest_asyncio

# Istanbul — well within the Turkey bounding box.
ISTANBUL = {"lat": 41.0082, "lng": 28.9784}

# Outside Turkey (mid-Atlantic).
OUTSIDE_TURKEY = {"lat": 0.0, "lng": 0.0}

VALID_BOOK_PAYLOAD: dict[str, Any] = {
    "title": "Suç ve Ceza",
    "author": "Dostoyevski",
    "isbn": "9789750738948",
    "description": "Klasik bir roman",
    "category": "fiction",
    "language": "tr",
    "condition": "good",
    "location": ISTANBUL,
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
