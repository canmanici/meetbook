import httpx
import pytest


async def _register(client: httpx.AsyncClient, email: str) -> dict:
    resp = await client.post(
        "/api/v1/auth/register",
        json={
            "email": email,
            "password": "securepass123",
            "name": "Test User",
            "kvkk_consent": True,
        },
    )
    body = resp.json()
    return {
        "user_id": body["user_id"],
        "headers": {"Authorization": f"Bearer {body['access_token']}"},
    }


@pytest.mark.asyncio
async def test_get_me_returns_profile(client: httpx.AsyncClient) -> None:
    user = await _register(client, "me_get@example.com")

    resp = await client.get("/api/v1/auth/me", headers=user["headers"])
    assert resp.status_code == 200
    body = resp.json()
    assert body["id"] == user["user_id"]
    assert body["email"] == "me_get@example.com"
    assert body["trusted_contact_name"] is None
    assert body["trusted_contact_phone"] is None


@pytest.mark.asyncio
async def test_update_me_sets_trusted_contact(client: httpx.AsyncClient) -> None:
    user = await _register(client, "me_update@example.com")

    resp = await client.patch(
        "/api/v1/auth/me",
        json={"trusted_contact_name": "Ayse", "trusted_contact_phone": "+905551234567"},
        headers=user["headers"],
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["trusted_contact_name"] == "Ayse"
    assert body["trusted_contact_phone"] == "+905551234567"

    get_resp = await client.get("/api/v1/auth/me", headers=user["headers"])
    assert get_resp.json()["trusted_contact_name"] == "Ayse"


@pytest.mark.asyncio
async def test_update_me_clears_trusted_contact(client: httpx.AsyncClient) -> None:
    user = await _register(client, "me_clear@example.com")

    await client.patch(
        "/api/v1/auth/me",
        json={"trusted_contact_name": "Ayse", "trusted_contact_phone": "+905551234567"},
        headers=user["headers"],
    )

    resp = await client.patch(
        "/api/v1/auth/me",
        json={},
        headers=user["headers"],
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["trusted_contact_name"] is None
    assert body["trusted_contact_phone"] is None


@pytest.mark.asyncio
async def test_me_requires_auth(client: httpx.AsyncClient) -> None:
    resp = await client.get("/api/v1/auth/me")
    assert resp.status_code == 401
