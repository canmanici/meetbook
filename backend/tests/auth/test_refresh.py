import httpx
import pytest


@pytest.mark.asyncio
async def test_refresh_success(client: httpx.AsyncClient) -> None:
    await client.post(
        "/api/v1/auth/register",
        json={
            "email": "refresh@example.com",
            "password": "securepass123",
            "name": "Test User",
        },
    )
    login_resp = await client.post(
        "/api/v1/auth/login",
        json={"email": "refresh@example.com", "password": "securepass123"},
    )
    tokens = login_resp.json()

    resp = await client.post(
        "/api/v1/auth/refresh",
        json={"refresh_token": tokens["refresh_token"]},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert "access_token" in body
    assert "refresh_token" in body
    assert body["refresh_token"] != tokens["refresh_token"]


@pytest.mark.asyncio
async def test_refresh_old_token_revoked(client: httpx.AsyncClient) -> None:
    await client.post(
        "/api/v1/auth/register",
        json={
            "email": "refresh_revoke@example.com",
            "password": "securepass123",
            "name": "Test User",
        },
    )
    login_resp = await client.post(
        "/api/v1/auth/login",
        json={"email": "refresh_revoke@example.com", "password": "securepass123"},
    )
    tokens = login_resp.json()

    await client.post(
        "/api/v1/auth/refresh",
        json={"refresh_token": tokens["refresh_token"]},
    )
    resp = await client.post(
        "/api/v1/auth/refresh",
        json={"refresh_token": tokens["refresh_token"]},
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_refresh_invalid_token(client: httpx.AsyncClient) -> None:
    resp = await client.post(
        "/api/v1/auth/refresh",
        json={"refresh_token": "invalid-token-12345"},
    )
    assert resp.status_code == 401
