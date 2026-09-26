import httpx
import pytest

from tests.books.conftest import ISTANBUL, VALID_BOOK_PAYLOAD


@pytest.mark.asyncio
async def test_search_bbox_returns_books(client: httpx.AsyncClient, register_user) -> None:
    owner = await register_user("bbox_owner@example.com", "BBox Owner")
    await client.post("/api/v1/books", json=VALID_BOOK_PAYLOAD, headers=owner["headers"])

    searcher = await register_user("bbox_searcher@example.com", "BBox Searcher")
    resp = await client.get(
        "/api/v1/books/search-bbox?min_lat=40.9&max_lat=41.1&min_lng=28.8&max_lng=29.1",
        headers=searcher["headers"],
    )
    assert resp.status_code == 200
    items = resp.json()["items"]
    assert len(items) >= 1


@pytest.mark.asyncio
async def test_search_bbox_rejects_inverted_coordinates(
    client: httpx.AsyncClient, register_user
) -> None:
    user = await register_user("bbox_inv@example.com", "BBox Inv")
    resp = await client.get(
        "/api/v1/books/search-bbox?min_lat=41.1&max_lat=40.9&min_lng=28.8&max_lng=29.1",
        headers=user["headers"],
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_search_bbox_rejects_too_large_area(client: httpx.AsyncClient, register_user) -> None:
    user = await register_user("bbox_large@example.com", "BBox Large")
    resp = await client.get(
        "/api/v1/books/search-bbox?min_lat=40.0&max_lat=42.0&min_lng=28.0&max_lng=31.0",
        headers=user["headers"],
    )
    assert resp.status_code == 422
    assert "geniş" in resp.json()["detail"].lower()


@pytest.mark.asyncio
async def test_search_bbox_respects_category_filter(
    client: httpx.AsyncClient, register_user
) -> None:
    owner = await register_user("bbox_cat@example.com", "BBox Cat")
    payload = {**VALID_BOOK_PAYLOAD, "category": "fiction"}
    await client.post("/api/v1/books", json=payload, headers=owner["headers"])

    payload2 = {**VALID_BOOK_PAYLOAD, "title": "Different", "category": "textbook"}
    await client.post("/api/v1/books", json=payload2, headers=owner["headers"])

    searcher = await register_user("bbox_cat_search@example.com", "BBox Cat Search")
    resp = await client.get(
        "/api/v1/books/search-bbox"
        "?min_lat=40.9&max_lat=41.1&min_lng=28.8&max_lng=29.1&category=fiction",
        headers=searcher["headers"],
    )
    assert resp.status_code == 200
    items = resp.json()["items"]
    assert all(b["category"] == "fiction" for b in items)
