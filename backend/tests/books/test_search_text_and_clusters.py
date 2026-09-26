"""Search text matching (Turkish folding, wildcard escaping) and cluster payloads."""

import httpx
import pytest

from tests.books.conftest import VALID_BOOK_PAYLOAD

BBOX = "min_lat=40.9&max_lat=41.1&min_lng=28.8&max_lng=29.1"


async def _search(client: httpx.AsyncClient, headers: dict[str, str], q: str) -> list[str]:
    # httpx `params` replaces an inline query string — pass everything here.
    params = {"min_lat": 40.9, "max_lat": 41.1, "min_lng": 28.8, "max_lng": 29.1, "q": q}
    resp = await client.get("/api/v1/books/search-bbox", params=params, headers=headers)
    assert resp.status_code == 200, resp.text
    return sorted(b["title"] for b in resp.json()["items"])


@pytest.mark.asyncio
async def test_turkish_letters_match_case_and_accent_insensitively(
    client: httpx.AsyncClient, register_user
) -> None:
    owner = await register_user("tr_owner@example.com", "Owner")
    for title in ("IRMAK KENARI", "Şeker Portakalı"):
        await client.post(
            "/api/v1/books", json={**VALID_BOOK_PAYLOAD, "title": title}, headers=owner["headers"]
        )
    searcher = await register_user("tr_search@example.com", "Search")
    h = searcher["headers"]

    assert await _search(client, h, "ırmak") == ["IRMAK KENARI"]
    assert await _search(client, h, "seker") == ["Şeker Portakalı"]
    assert await _search(client, h, "PORTAKALI") == ["Şeker Portakalı"]


@pytest.mark.asyncio
async def test_like_wildcards_are_literal(client: httpx.AsyncClient, register_user) -> None:
    owner = await register_user("wild_owner@example.com", "Owner")
    await client.post(
        "/api/v1/books", json={**VALID_BOOK_PAYLOAD, "title": "Normal"}, headers=owner["headers"]
    )
    await client.post(
        "/api/v1/books",
        json={**VALID_BOOK_PAYLOAD, "title": "100% Gerçek"},
        headers=owner["headers"],
    )
    searcher = await register_user("wild_search@example.com", "Search")
    assert await _search(client, searcher["headers"], "%") == ["100% Gerçek"]
    assert await _search(client, searcher["headers"], "_") == []


@pytest.mark.asyncio
async def test_clusters_carry_member_books_and_real_distance(
    client: httpx.AsyncClient, register_user
) -> None:
    owner = await register_user("cl_owner@example.com", "Owner")
    for title, loc in (
        ("A", {"lat": 41.0082, "lng": 28.9784}),
        ("B", {"lat": 41.0083, "lng": 28.9785}),  # ~11m from A → same shelf
        ("C", {"lat": 41.05, "lng": 29.05}),  # far → singleton
    ):
        await client.post(
            "/api/v1/books",
            json={**VALID_BOOK_PAYLOAD, "title": title, "location": loc},
            headers=owner["headers"],
        )
    searcher = await register_user("cl_search@example.com", "Search")
    resp = await client.get(
        f"/api/v1/books/clusters?{BBOX}&origin_lat=41.0082&origin_lng=28.9784",
        headers=searcher["headers"],
    )
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["clusters"]) == 1
    assert sorted(b["title"] for b in body["clusters"][0]["books"]) == ["A", "B"]
    [single] = body["singletons"]
    assert single["title"] == "C"
    assert single["distance_km"] > 5  # measured from the origin, not 0.0
