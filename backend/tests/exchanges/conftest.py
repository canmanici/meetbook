"""Shared helpers for exchanges module tests."""

from collections.abc import Awaitable, Callable
from typing import Any

import httpx
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.geo import TURKEY_BOUNDARY_WKT

ISTANBUL = {"lat": 41.0082, "lng": 28.9784}
KADIKOY_CAFE = {"lat": 40.9909, "lng": 29.0304}
# Outside the country_boundaries polygon but inside the Turkey bounding box —
# the negative test for the polygon geofence specifically.
RHODES = {"lat": 36.43, "lng": 28.22}

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
async def seed_turkey_boundary(db_session: AsyncSession) -> None:
    """Seed `country_boundaries` with the Turkey polygon (normally done by the
    migration's data seed, which `create_all` doesn't run for the test DB)."""
    # TURKEY_BOUNDARY_WKT is a hardcoded module constant, not user input.
    await db_session.execute(
        text(
            "INSERT INTO country_boundaries (name, geom) VALUES "  # noqa: S608
            "('turkey', ST_GeogFromText('SRID=4326;" + TURKEY_BOUNDARY_WKT + "')) "
            "ON CONFLICT (name) DO NOTHING"
        )
    )
    await db_session.commit()


@pytest_asyncio.fixture
async def block_place(
    db_session: AsyncSession,
) -> Callable[[float, float], Awaitable[None]]:
    async def _block(lat: float, lng: float) -> None:
        await db_session.execute(
            text(
                "INSERT INTO blocked_places (id, lat, lng, geom, reason, created_at) VALUES "
                "(gen_random_uuid(), :lat, :lng, "
                "ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography, 'test', now())"
            ),
            {"lat": lat, "lng": lng},
        )
        await db_session.commit()

    return _block
