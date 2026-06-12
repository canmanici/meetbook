import httpx
import pytest


@pytest.mark.asyncio
async def test_login_success(client: httpx.AsyncClient) -> None:
    await client.post(
        "/api/v1/auth/register",
        json={
            "email": "login@example.com",
            "password": "securepass123",
            "name": "Test User",
            "kvkk_consent": True,
        },
    )
    resp = await client.post(
        "/api/v1/auth/login",
        json={"email": "login@example.com", "password": "securepass123"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert "access_token" in body
    assert "refresh_token" in body
    assert body["user"] == {
        "id": body["user"]["id"],
        "email": "login@example.com",
        "name": "Test User",
    }


@pytest.mark.asyncio
async def test_login_wrong_password(client: httpx.AsyncClient) -> None:
    await client.post(
        "/api/v1/auth/register",
        json={
            "email": "login@example.com",
            "password": "securepass123",
            "name": "Test User",
            "kvkk_consent": True,
        },
    )
    resp = await client.post(
        "/api/v1/auth/login",
        json={"email": "login@example.com", "password": "wrongpassword"},
    )
    assert resp.status_code == 401
    assert resp.json()["detail"] == "Email or password is incorrect"


@pytest.mark.asyncio
async def test_login_nonexistent_email(client: httpx.AsyncClient) -> None:
    resp = await client.post(
        "/api/v1/auth/login",
        json={"email": "noone@example.com", "password": "securepass123"},
    )
    assert resp.status_code == 401
    assert resp.json()["detail"] == "Email or password is incorrect"
