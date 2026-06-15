"""Shared helpers for admin/reports module tests."""

import uuid
from collections.abc import Awaitable, Callable
from typing import Any

import httpx
import pytest_asyncio
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.auth.models import User


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
async def make_admin(
    db_session: AsyncSession,
) -> Callable[[str], Awaitable[None]]:
    async def _make_admin(user_id: str) -> None:
        await db_session.execute(
            update(User).where(User.id == uuid.UUID(user_id)).values(is_admin=True)
        )
        await db_session.commit()

    return _make_admin
