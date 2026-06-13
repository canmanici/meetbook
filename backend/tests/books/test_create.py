import httpx
import pytest

from tests.books.conftest import OUTSIDE_TURKEY, VALID_BOOK_PAYLOAD


@pytest.mark.asyncio
async def test_create_success(client: httpx.AsyncClient, register_user) -> None:
    owner = await register_user("create_owner@example.com", "Owner")

    resp = await client.post(
        "/api/v1/books", json=VALID_BOOK_PAYLOAD, headers=owner["headers"]
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["title"] == "Suç ve Ceza"
    assert body["owner_id"] == owner["user_id"]
    assert body["location"] == {"lat": 41.0082, "lng": 28.9784}
    # Static blur, grid=0.01: round(41.0082/0.01)*0.01 = 41.01, round(28.9784/0.01)*0.01 = 28.98
    assert body["public_location"] == {"lat": 41.01, "lng": 28.98}
    assert body["is_available"] is True


@pytest.mark.asyncio
async def test_create_outside_turkey_bbox_rejected(
    client: httpx.AsyncClient, register_user
) -> None:
    owner = await register_user("create_bbox@example.com", "Owner")

    payload = {**VALID_BOOK_PAYLOAD, "location": OUTSIDE_TURKEY}
    resp = await client.post("/api/v1/books", json=payload, headers=owner["headers"])
    assert resp.status_code == 400
    assert resp.json()["detail"] == "LOCATION_OUTSIDE_TURKEY"


@pytest.mark.asyncio
async def test_create_requires_auth(client: httpx.AsyncClient) -> None:
    resp = await client.post("/api/v1/books", json=VALID_BOOK_PAYLOAD)
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_blur_is_static_for_nearby_points(
    client: httpx.AsyncClient, register_user
) -> None:
    owner = await register_user("create_blur@example.com", "Owner")

    payload_a = {**VALID_BOOK_PAYLOAD, "location": {"lat": 41.001, "lng": 28.991}}
    payload_b = {**VALID_BOOK_PAYLOAD, "location": {"lat": 41.004, "lng": 28.994}}

    resp_a = await client.post("/api/v1/books", json=payload_a, headers=owner["headers"])
    resp_b = await client.post("/api/v1/books", json=payload_b, headers=owner["headers"])

    assert resp_a.json()["public_location"] == resp_b.json()["public_location"]
