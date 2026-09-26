import httpx
import pytest

from tests.books.conftest import ISTANBUL, VALID_BOOK_PAYLOAD


@pytest.mark.asyncio
async def test_search_result_includes_owner_summary(
    client: httpx.AsyncClient,
    register_user,
) -> None:
    owner = await register_user("owner_summary@example.com", "Owner Summary")
    await client.post("/api/v1/books", json=VALID_BOOK_PAYLOAD, headers=owner["headers"])

    searcher = await register_user("searcher_summary@example.com", "Searcher")
    resp = await client.get(
        f"/api/v1/books/search?lat={ISTANBUL['lat']}&lng={ISTANBUL['lng']}&radius_km=10",
        headers=searcher["headers"],
    )
    assert resp.status_code == 200
    items = resp.json()["items"]
    assert len(items) >= 1
    owner_obj = items[0]["owner"]
    assert owner_obj["name"] == "Owner Summary"
    assert "book_count" in owner_obj
    assert "rating_avg" in owner_obj
    assert "rating_count" in owner_obj
    assert isinstance(owner_obj["book_count"], int)
