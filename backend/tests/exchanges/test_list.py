import httpx
import pytest


async def _create_exchange(client: httpx.AsyncClient, requester: dict, book_id: str) -> str:
    resp = await client.post(
        "/api/v1/exchanges",
        json={"book_id": book_id, "initial_message": "Hi"},
        headers=requester["headers"],
    )
    assert resp.status_code == 201
    return resp.json()["id"]


@pytest.mark.asyncio
async def test_list_sent_and_received(
    client: httpx.AsyncClient, register_user, create_book
) -> None:
    owner = await register_user("list_owner@example.com", "Owner")
    requester = await register_user("list_requester@example.com", "Requester")
    book_id = await create_book(owner["headers"])

    exchange_id = await _create_exchange(client, requester, book_id)

    sent = await client.get(
        "/api/v1/exchanges", params={"role": "sent"}, headers=requester["headers"]
    )
    assert sent.status_code == 200
    sent_ids = [item["id"] for item in sent.json()["items"]]
    assert exchange_id in sent_ids

    received = await client.get(
        "/api/v1/exchanges", params={"role": "received"}, headers=owner["headers"]
    )
    assert received.status_code == 200
    received_ids = [item["id"] for item in received.json()["items"]]
    assert exchange_id in received_ids

    # The requester has nothing in "received", and the owner has nothing in "sent".
    requester_received = await client.get(
        "/api/v1/exchanges", params={"role": "received"}, headers=requester["headers"]
    )
    assert exchange_id not in [item["id"] for item in requester_received.json()["items"]]

    owner_sent = await client.get(
        "/api/v1/exchanges", params={"role": "sent"}, headers=owner["headers"]
    )
    assert exchange_id not in [item["id"] for item in owner_sent.json()["items"]]


@pytest.mark.asyncio
async def test_list_filters_by_status(
    client: httpx.AsyncClient, register_user, create_book
) -> None:
    owner = await register_user("list_status_owner@example.com", "Owner")
    requester = await register_user("list_status_requester@example.com", "Requester")
    book_id = await create_book(owner["headers"])

    exchange_id = await _create_exchange(client, requester, book_id)

    pending = await client.get(
        "/api/v1/exchanges",
        params={"role": "sent", "status": "pending"},
        headers=requester["headers"],
    )
    assert exchange_id in [item["id"] for item in pending.json()["items"]]

    accepted = await client.get(
        "/api/v1/exchanges",
        params={"role": "sent", "status": "accepted"},
        headers=requester["headers"],
    )
    assert exchange_id not in [item["id"] for item in accepted.json()["items"]]


@pytest.mark.asyncio
async def test_list_pagination(client: httpx.AsyncClient, register_user, create_book) -> None:
    requester = await register_user("list_page_requester@example.com", "Requester")

    book_ids = []
    for i in range(3):
        owner = await register_user(f"list_page_owner{i}@example.com", f"Owner{i}")
        book_ids.append(await create_book(owner["headers"]))

    for book_id in book_ids:
        await _create_exchange(client, requester, book_id)

    first_page = await client.get(
        "/api/v1/exchanges",
        params={"role": "sent", "limit": 2},
        headers=requester["headers"],
    )
    assert first_page.status_code == 200
    first_body = first_page.json()
    assert len(first_body["items"]) == 2
    assert first_body["next_cursor"] is not None

    second_page = await client.get(
        "/api/v1/exchanges",
        params={"role": "sent", "limit": 2, "cursor": first_body["next_cursor"]},
        headers=requester["headers"],
    )
    assert second_page.status_code == 200
    second_body = second_page.json()
    assert len(second_body["items"]) == 1

    first_ids = {item["id"] for item in first_body["items"]}
    second_ids = {item["id"] for item in second_body["items"]}
    assert first_ids.isdisjoint(second_ids)
