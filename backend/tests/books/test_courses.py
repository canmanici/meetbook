"""Course codes on listings, course search, and the no-money listing rule."""

from typing import Any

import httpx
import pytest

from tests.books.conftest import ISTANBUL, VALID_BOOK_PAYLOAD

pytestmark = pytest.mark.asyncio


async def _list(
    client: httpx.AsyncClient, headers: dict[str, str], **fields: Any
) -> httpx.Response:
    return await client.post(
        "/api/v1/books", json={**VALID_BOOK_PAYLOAD, **fields}, headers=headers
    )


async def test_course_code_is_normalized_and_returned(client, register_user) -> None:
    owner = await register_user("c_owner@example.com", "Owner")
    resp = await _list(
        client, owner["headers"], course_code="mat-101", instructor="  Prof.  Ayşe   Kaya "
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["course_code"] == "MAT101"
    assert body["instructor"] == "Prof. Ayşe Kaya"


async def test_invalid_course_code_is_rejected(client, register_user) -> None:
    owner = await register_user("c_bad@example.com", "Owner")
    assert (await _list(client, owner["headers"], course_code="101")).status_code == 422
    assert (await _list(client, owner["headers"], course_code="MATH")).status_code == 422


async def test_search_by_course_finds_only_that_course(client, register_user) -> None:
    owner = await register_user("c_owner2@example.com", "Owner")
    student = await register_user("c_student@example.com", "Student")
    await _list(client, owner["headers"], title="Calculus", course_code="MAT101")
    await _list(client, owner["headers"], title="Fizik I", course_code="FIZ101")
    await _list(client, owner["headers"], title="Roman")

    resp = await client.get(
        "/api/v1/books/search",
        params={"course": "mat 101", **ISTANBUL, "radius_km": 50},
        headers=student["headers"],
    )
    assert resp.status_code == 200
    assert [b["title"] for b in resp.json()["items"]] == ["Calculus"]

    # Typing the code into the normal search bar works too.
    resp = await client.get(
        "/api/v1/books/search",
        params={"q": "fiz101", **ISTANBUL, "radius_km": 50},
        headers=student["headers"],
    )
    assert [b["title"] for b in resp.json()["items"]] == ["Fizik I"]


async def test_course_list_counts_available_copies_by_prefix(client, register_user) -> None:
    a = await register_user("c_a@example.com", "A")
    b = await register_user("c_b@example.com", "B")
    viewer = await register_user("c_viewer@example.com", "Viewer")
    await _list(client, a["headers"], course_code="MAT101", instructor="Prof. Kaya")
    await _list(client, b["headers"], course_code="MAT101", instructor="Prof. Demir")
    await _list(client, b["headers"], course_code="MAT102")
    await _list(client, b["headers"], course_code="FIZ101")

    resp = await client.get("/api/v1/books/courses", params={"q": "mat"}, headers=viewer["headers"])
    assert resp.status_code == 200
    items = resp.json()["items"]
    assert [(i["course_code"], i["book_count"]) for i in items] == [("MAT101", 2), ("MAT102", 1)]
    assert sorted(items[0]["instructors"]) == ["Prof. Demir", "Prof. Kaya"]

    # Your own books are not "available to you".
    mine = await client.get("/api/v1/books/courses", params={"q": "FIZ"}, headers=b["headers"])
    assert mine.json()["items"] == []


@pytest.mark.parametrize(
    "fields",
    [
        {"description": "Temiz, 150 TL"},
        {"description": "fiyatı 200₺"},
        {"description": "Satılık, dm at"},
        {"description": "Ulaşın: 0532 123 45 67"},
        {"description": "IBAN TR12 0006 1005 1978 6457 8413 26"},
        {"instructor": "Prof. X — kitabı benden 300 TL"},
    ],
)
async def test_listing_with_price_phone_or_iban_is_refused(
    client, register_user, fields: dict[str, str]
) -> None:
    owner = await register_user("c_seller@example.com", "Seller")
    resp = await _list(client, owner["headers"], **fields)
    assert resp.status_code == 422
    assert resp.json()["detail"] == "COMMERCIAL_CONTENT"


async def test_ordinary_description_with_numbers_is_allowed(client, register_user) -> None:
    owner = await register_user("c_ok@example.com", "Owner")
    resp = await _list(
        client,
        owner["headers"],
        description="3. baskı (2019), 250-300. sayfalar notlu. ISBN 9786051234567",
    )
    assert resp.status_code == 201, resp.text


async def test_editing_in_a_price_is_refused(client, register_user) -> None:
    owner = await register_user("c_edit@example.com", "Owner")
    book_id = (await _list(client, owner["headers"])).json()["id"]
    resp = await client.patch(
        f"/api/v1/books/{book_id}", json={"description": "100 TL"}, headers=owner["headers"]
    )
    assert resp.status_code == 422
    assert resp.json()["detail"] == "COMMERCIAL_CONTENT"
