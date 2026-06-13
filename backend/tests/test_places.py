"""Tests for the Places proxy module — degrade path and Redis caching."""

import json
from unittest.mock import AsyncMock, patch

import httpx
import pytest

from app.core.config import get_settings
from app.modules.places import service as places_service


class FakeRedis:
    """Minimal dict-backed async redis substitute for cache-hit assertions."""

    def __init__(self) -> None:
        self.store: dict[str, str] = {}

    async def get(self, key: str) -> str | None:
        return self.store.get(key)

    async def set(self, key: str, value: str, ex: int | None = None) -> bool:
        self.store[key] = value
        return True


@pytest.mark.asyncio
async def test_autocomplete_degrades_when_no_key(redis_mock) -> None:
    items = await places_service.autocomplete(redis_mock, "kadikoy", 41.0, 29.0)
    assert items == []


@pytest.mark.asyncio
async def test_nearby_degrades_when_no_key(redis_mock) -> None:
    items = await places_service.nearby(redis_mock, 41.0, 29.0)
    assert items == []


@pytest.mark.asyncio
async def test_details_degrades_when_no_key(redis_mock) -> None:
    result = await places_service.details(redis_mock, "some-place-id")
    assert result is None


@pytest.mark.asyncio
async def test_autocomplete_caches_response(monkeypatch) -> None:
    settings = get_settings()
    monkeypatch.setattr(settings, "google_places_key", "test-key")

    redis = FakeRedis()
    mock_response = httpx.Response(
        200,
        json={
            "predictions": [
                {"place_id": "p1", "description": "Kadikoy Cafe, Istanbul"},
            ]
        },
    )

    with patch("httpx.AsyncClient.get", new=AsyncMock(return_value=mock_response)) as mock_get:
        items_first = await places_service.autocomplete(redis, "kadikoy", 41.0, 29.0)
        assert items_first == [{"place_id": "p1", "description": "Kadikoy Cafe, Istanbul"}]
        assert mock_get.call_count == 1

        # Second call hits the Redis cache, no second HTTP request.
        items_second = await places_service.autocomplete(redis, "kadikoy", 41.0, 29.0)
        assert items_second == items_first
        assert mock_get.call_count == 1


@pytest.mark.asyncio
async def test_nearby_caches_response_and_maps_category(monkeypatch) -> None:
    settings = get_settings()
    monkeypatch.setattr(settings, "google_places_key", "test-key")

    redis = FakeRedis()
    mock_response = httpx.Response(
        200,
        json={
            "results": [
                {
                    "place_id": "cafe1",
                    "name": "Kadikoy Cafe",
                    "vicinity": "Kadikoy",
                    "types": ["cafe", "food"],
                    "geometry": {"location": {"lat": 40.99, "lng": 29.03}},
                }
            ]
        },
    )

    with patch("httpx.AsyncClient.get", new=AsyncMock(return_value=mock_response)) as mock_get:
        items = await places_service.nearby(redis, 40.99, 29.03)
        assert len(items) == 1
        assert items[0].category == "cafe"
        first_call_count = mock_get.call_count

        cached_items = await places_service.nearby(redis, 40.99, 29.03)
        assert [i.model_dump() for i in cached_items] == [i.model_dump() for i in items]
        assert mock_get.call_count == first_call_count


@pytest.mark.asyncio
async def test_places_endpoints_require_auth(client: httpx.AsyncClient) -> None:
    resp = await client.get("/api/v1/places/autocomplete", params={"query": "x", "lat": 41, "lng": 29})
    assert resp.status_code == 401

    resp = await client.get("/api/v1/places/nearby", params={"lat": 41, "lng": 29})
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_places_nearby_endpoint_authenticated_empty(client: httpx.AsyncClient) -> None:
    register_resp = await client.post(
        "/api/v1/auth/register",
        json={
            "email": "places_nearby@example.com",
            "password": "securepass123",
            "name": "User",
            "kvkk_consent": True,
        },
    )
    headers = {"Authorization": f"Bearer {register_resp.json()['access_token']}"}

    resp = await client.get(
        "/api/v1/places/nearby", params={"lat": 41.0, "lng": 29.0}, headers=headers
    )
    assert resp.status_code == 200
    assert resp.json() == {"items": []}
