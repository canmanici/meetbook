import httpx
import pytest

from tests.books.conftest import ISTANBUL, VALID_BOOK_PAYLOAD


@pytest.mark.asyncio
async def test_clusters_single_book_is_singleton(
    client: httpx.AsyncClient, register_user
) -> None:
    owner = await register_user("cluster_single@example.com", "Cluster Single")
    await client.post("/api/v1/books", json=VALID_BOOK_PAYLOAD, headers=owner["headers"])

    searcher = await register_user("cluster_single_search@example.com", "Search")
    resp = await client.get(
        "/api/v1/books/clusters"
        "?min_lat=40.9&max_lat=41.1&min_lng=28.8&max_lng=29.1",
        headers=searcher["headers"],
    )
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["clusters"]) == 0
    assert len(body["singletons"]) == 1


@pytest.mark.asyncio
async def test_clusters_multiple_nearby_books_form_cluster(
    client: httpx.AsyncClient, register_user
) -> None:
    owner = await register_user("cluster_multi@example.com", "Cluster Multi")
    # Two books within ~30m of each other (tiny coord offset)
    loc1 = {"lat": 41.0082, "lng": 28.9784}
    loc2 = {"lat": 41.0083, "lng": 28.9785}  # ~11m away
    await client.post("/api/v1/books", json={**VALID_BOOK_PAYLOAD, "location": loc1}, headers=owner["headers"])
    await client.post("/api/v1/books", json={**VALID_BOOK_PAYLOAD, "title": "Second", "location": loc2}, headers=owner["headers"])

    searcher = await register_user("cluster_multi_search@example.com", "Search")
    resp = await client.get(
        "/api/v1/books/clusters"
        "?min_lat=40.9&max_lat=41.1&min_lng=28.8&max_lng=29.1",
        headers=searcher["headers"],
    )
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["clusters"]) == 1
    assert body["clusters"][0]["count"] == 2
    assert len(body["singletons"]) == 0
