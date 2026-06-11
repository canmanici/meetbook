import httpx
import pytest


@pytest.mark.asyncio
async def test_register_success(client: httpx.AsyncClient) -> None:
    resp = await client.post(
        "/api/v1/auth/register",
        json={
            "email": "test@example.com",
            "password": "securepass123",
            "name": "Test User",
        },
    )
    assert resp.status_code == 201
    body = resp.json()
    assert "user_id" in body
    assert "access_token" in body
    assert "refresh_token" in body


@pytest.mark.asyncio
async def test_register_duplicate_email(client: httpx.AsyncClient) -> None:
    payload = {
        "email": "dup@example.com",
        "password": "securepass123",
        "name": "Test User",
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
        },
    )
    assert resp.status_code == 422
