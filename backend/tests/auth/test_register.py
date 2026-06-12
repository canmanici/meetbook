import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.auth.models import User


@pytest.mark.asyncio
async def test_register_success(client: httpx.AsyncClient) -> None:
    resp = await client.post(
        "/api/v1/auth/register",
        json={
            "email": "test@example.com",
            "password": "securepass123",
            "name": "Test User",
            "kvkk_consent": True,
        },
    )
    assert resp.status_code == 201
    body = resp.json()
    assert "user_id" in body
    assert "access_token" in body
    assert "refresh_token" in body
    assert body["user"] == {
        "id": body["user_id"],
        "email": "test@example.com",
        "name": "Test User",
    }


@pytest.mark.asyncio
async def test_register_duplicate_email(client: httpx.AsyncClient) -> None:
    payload = {
        "email": "dup@example.com",
        "password": "securepass123",
        "name": "Test User",
        "kvkk_consent": True,
    }
    await client.post("/api/v1/auth/register", json=payload)
    resp = await client.post("/api/v1/auth/register", json=payload)
    assert resp.status_code == 409


@pytest.mark.asyncio
async def test_register_weak_password(client: httpx.AsyncClient) -> None:
    resp = await client.post(
        "/api/v1/auth/register",
        json={
            "email": "weak@example.com",
            "password": "short",
            "name": "Test User",
            "kvkk_consent": True,
        },
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_register_invalid_email(client: httpx.AsyncClient) -> None:
    resp = await client.post(
        "/api/v1/auth/register",
        json={
            "email": "not-an-email",
            "password": "securepass123",
            "name": "Test User",
            "kvkk_consent": True,
        },
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_register_requires_kvkk_consent(client: httpx.AsyncClient) -> None:
    resp = await client.post(
        "/api/v1/auth/register",
        json={
            "email": "noconsent@example.com",
            "password": "securepass123",
            "name": "Test User",
            "kvkk_consent": False,
        },
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_register_sets_kvkk_and_verifies_email(
    client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    resp = await client.post(
        "/api/v1/auth/register",
        json={
            "email": "kvkk@example.com",
            "password": "securepass123",
            "name": "Test User",
            "kvkk_consent": True,
        },
    )
    assert resp.status_code == 201

    result = await db_session.execute(select(User).where(User.email == "kvkk@example.com"))
    user = result.scalar_one()
    assert user.email_verified_at is not None
    assert user.kvkk_consent_at is not None
    assert user.kvkk_policy_version == "1.0"
