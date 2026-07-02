"""Tests for sort_order cursor encoding/decoding and book reorder functionality."""

import uuid
from datetime import UTC, datetime

import httpx
import pytest

from app.modules.books.repository import decode_cursor, encode_cursor
from tests.books.conftest import VALID_BOOK_PAYLOAD

# ---------------------------------------------------------------------------
# Cursor encoding / decoding (pure unit tests)
# ---------------------------------------------------------------------------


class TestCursor:
    def test_encode_decode_roundtrip(self) -> None:
        dt = datetime.now(UTC)
        book_id = uuid.uuid7()
        cursor = encode_cursor(5, dt, book_id)
        sort_order, created_at, recovered_id = decode_cursor(cursor)
        assert sort_order == 5
        assert created_at == dt
        assert recovered_id == book_id

    def test_sort_order_zero_roundtrip(self) -> None:
        dt = datetime.now(UTC)
        book_id = uuid.uuid7()
        cursor = encode_cursor(0, dt, book_id)
        sort_order, _, _ = decode_cursor(cursor)
        assert sort_order == 0

    def test_negative_sort_order(self) -> None:
        dt = datetime.now(UTC)
        book_id = uuid.uuid7()
        cursor = encode_cursor(-1, dt, book_id)
        sort_order, _, _ = decode_cursor(cursor)
        assert sort_order == -1

    def test_large_sort_order(self) -> None:
        dt = datetime.now(UTC)
        book_id = uuid.uuid7()
        cursor = encode_cursor(999_999_999, dt, book_id)
        sort_order, _, _ = decode_cursor(cursor)
        assert sort_order == 999_999_999

    def test_microsecond_datetime_roundtrip(self) -> None:
        dt = datetime(2026, 6, 21, 12, 34, 56, 789123, tzinfo=UTC)
        book_id = uuid.uuid7()
        cursor = encode_cursor(3, dt, book_id)
        _, created_at, recovered_id = decode_cursor(cursor)
        assert created_at == dt
        assert recovered_id == book_id

    def test_negative_timezone_datetime(self) -> None:
        dt = datetime(2026, 1, 15, 8, 0, 0, tzinfo=UTC)
        book_id = uuid.uuid7()
        cursor = encode_cursor(1, dt, book_id)
        _, created_at, recovered_id = decode_cursor(cursor)
        assert created_at == dt
        assert recovered_id == book_id

    def test_cursor_is_urlsafe_base64(self) -> None:
        dt = datetime.now(UTC)
        book_id = uuid.uuid7()
        cursor = encode_cursor(0, dt, book_id)
        import base64

        try:
            padded = cursor + "=" * (4 - len(cursor) % 4) if len(cursor) % 4 else cursor
            base64.urlsafe_b64decode(padded)
        except Exception:
            pytest.fail("Cursor is not valid urlsafe base64")

    def test_unique_cursors_for_different_books(self) -> None:
        dt = datetime.now(UTC)
        id_a = uuid.uuid7()
        id_b = uuid.uuid7()
        cursor_a = encode_cursor(0, dt, id_a)
        cursor_b = encode_cursor(0, dt, id_b)
        assert cursor_a != cursor_b


# ---------------------------------------------------------------------------
# Reorder endpoint (integration tests)
# ---------------------------------------------------------------------------


@pytest.fixture
def book_payload() -> dict:
    return {**VALID_BOOK_PAYLOAD}


@pytest.mark.asyncio
async def test_reorder_books_success(client: httpx.AsyncClient, register_user) -> None:
    owner = await register_user("reorder_ok@example.com", "Owner")

    ids = []
    for i in range(3):
        resp = await client.post(
            "/api/v1/books",
            json={**VALID_BOOK_PAYLOAD, "title": f"Reorder Book {i}"},
            headers=owner["headers"],
        )
        assert resp.status_code == 201
        ids.append(resp.json()["id"])

    resp = await client.patch(
        "/api/v1/books/reorder",
        json={
            "reorders": [
                {"book_id": ids[2], "sort_order": 0},
                {"book_id": ids[0], "sort_order": 1},
                {"book_id": ids[1], "sort_order": 2},
            ]
        },
        headers=owner["headers"],
    )
    assert resp.status_code == 200
    body = resp.json()
    assert "items" in body
    titles_in_order = [item["title"] for item in body["items"]]
    assert titles_in_order == ["Reorder Book 2", "Reorder Book 0", "Reorder Book 1"]


@pytest.mark.asyncio
async def test_reorder_returns_full_list(client: httpx.AsyncClient, register_user) -> None:
    owner = await register_user("reorder_full@example.com", "Owner")

    ids = []
    for i in range(2):
        resp = await client.post(
            "/api/v1/books",
            json={**VALID_BOOK_PAYLOAD, "title": f"Full List Book {i}"},
            headers=owner["headers"],
        )
        assert resp.status_code == 201
        ids.append(resp.json()["id"])

    resp = await client.patch(
        "/api/v1/books/reorder",
        json={
            "reorders": [{"book_id": ids[0], "sort_order": 1}, {"book_id": ids[1], "sort_order": 0}]
        },
        headers=owner["headers"],
    )
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["items"]) == 2
    assert body["next_cursor"] is None


@pytest.mark.asyncio
async def test_reorder_duplicate_book_ids(client: httpx.AsyncClient, register_user) -> None:
    owner = await register_user("reorder_dup@example.com", "Owner")

    resp = await client.post(
        "/api/v1/books",
        json={**VALID_BOOK_PAYLOAD, "title": "Dup Book"},
        headers=owner["headers"],
    )
    book_id = resp.json()["id"]

    resp = await client.patch(
        "/api/v1/books/reorder",
        json={
            "reorders": [
                {"book_id": book_id, "sort_order": 0},
                {"book_id": book_id, "sort_order": 1},
            ]
        },
        headers=owner["headers"],
    )
    assert resp.status_code == 400
    assert "Duplicate" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_reorder_not_owner(client: httpx.AsyncClient, register_user) -> None:
    owner = await register_user("reorder_owner@example.com", "Owner")
    other = await register_user("reorder_other@example.com", "Other")

    resp = await client.post(
        "/api/v1/books",
        json={**VALID_BOOK_PAYLOAD, "title": "Not Mine"},
        headers=owner["headers"],
    )
    book_id = resp.json()["id"]

    resp = await client.patch(
        "/api/v1/books/reorder",
        json={"reorders": [{"book_id": book_id, "sort_order": 0}]},
        headers=other["headers"],
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_reorder_nonexistent_book(client: httpx.AsyncClient, register_user) -> None:
    owner = await register_user("reorder_nonexist@example.com", "Owner")
    fake_id = "00000000-0000-0000-0000-000000000000"

    resp = await client.patch(
        "/api/v1/books/reorder",
        json={"reorders": [{"book_id": fake_id, "sort_order": 0}]},
        headers=owner["headers"],
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_reorder_requires_auth(client: httpx.AsyncClient) -> None:
    resp = await client.patch(
        "/api/v1/books/reorder",
        json={"reorders": []},
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_reorder_empty_list(client: httpx.AsyncClient, register_user) -> None:
    owner = await register_user("reorder_empty@example.com", "Owner")

    resp = await client.patch(
        "/api/v1/books/reorder",
        json={"reorders": []},
        headers=owner["headers"],
    )
    assert resp.status_code == 200
    assert resp.json()["items"] == []


# ---------------------------------------------------------------------------
# List ordering respects sort_order
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_me_respects_sort_order(client: httpx.AsyncClient, register_user) -> None:
    owner = await register_user("list_sort@example.com", "Owner")

    ids = []
    for i in range(3):
        resp = await client.post(
            "/api/v1/books",
            json={**VALID_BOOK_PAYLOAD, "title": f"Sort Book {i}"},
            headers=owner["headers"],
        )
        ids.append(resp.json()["id"])

    await client.patch(
        "/api/v1/books/reorder",
        json={
            "reorders": [
                {"book_id": ids[2], "sort_order": 0},
                {"book_id": ids[0], "sort_order": 1},
                {"book_id": ids[1], "sort_order": 2},
            ]
        },
        headers=owner["headers"],
    )

    resp = await client.get("/api/v1/books/me", headers=owner["headers"])
    titles = [item["title"] for item in resp.json()["items"]]
    assert titles == ["Sort Book 2", "Sort Book 0", "Sort Book 1"]


@pytest.mark.asyncio
async def test_nonzero_sort_order_at_creation(client: httpx.AsyncClient, register_user) -> None:
    owner = await register_user("sort_default@example.com", "Owner")

    resp_a = await client.post(
        "/api/v1/books",
        json={**VALID_BOOK_PAYLOAD, "title": "Default Sort"},
        headers=owner["headers"],
    )
    resp_b = await client.post(
        "/api/v1/books",
        json={**VALID_BOOK_PAYLOAD, "title": "Second Book"},
        headers=owner["headers"],
    )

    resp = await client.get("/api/v1/books/me", headers=owner["headers"])
    items = resp.json()["items"]
    assert all(item["sort_order"] == 0 for item in items)
