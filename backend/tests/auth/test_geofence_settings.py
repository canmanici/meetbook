import uuid

import httpx
import pytest


async def _register(client: httpx.AsyncClient) -> dict:
    email = f"gf_{uuid.uuid4().hex[:12]}@example.com"
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
async def test_get_me_includes_default_geofence_radius(client: httpx.AsyncClient) -> None:
    user = await _register(client)
    resp = await client.get("/api/v1/auth/me", headers=user["headers"])
    assert resp.status_code == 200
    assert resp.json()["geofence_radius_km"] == 10


@pytest.mark.asyncio
async def test_update_me_sets_geofence_radius(client: httpx.AsyncClient) -> None:
    user = await _register(client)
    resp = await client.patch(
        "/api/v1/auth/me",
        json={"geofence_radius_km": 25},
        headers=user["headers"],
    )
    assert resp.status_code == 200
    assert resp.json()["geofence_radius_km"] == 25


@pytest.mark.asyncio
async def test_update_me_rejects_radius_below_1(client: httpx.AsyncClient) -> None:
    user = await _register(client)
    resp = await client.patch(
        "/api/v1/auth/me",
        json={"geofence_radius_km": 0},
        headers=user["headers"],
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_update_me_rejects_radius_above_100(client: httpx.AsyncClient) -> None:
    user = await _register(client)
    resp = await client.patch(
        "/api/v1/auth/me",
        json={"geofence_radius_km": 101},
        headers=user["headers"],
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_update_me_preserves_radius_when_other_fields_set(client: httpx.AsyncClient) -> None:
    user = await _register(client)

    # Set radius first
    resp = await client.patch(
        "/api/v1/auth/me",
        json={"geofence_radius_km": 50},
        headers=user["headers"],
    )
    assert resp.status_code == 200

    # Update trusted contact, should not affect radius
    resp = await client.patch(
        "/api/v1/auth/me",
        json={"trusted_contact_name": "Mehmet"},
        headers=user["headers"],
    )
    assert resp.status_code == 200
    assert resp.json()["geofence_radius_km"] == 50
