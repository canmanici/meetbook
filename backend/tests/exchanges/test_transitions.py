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
async def test_accept_by_owner_succeeds(
    client: httpx.AsyncClient, register_user, create_book
) -> None:
    owner = await register_user("trans_accept_owner@example.com", "Owner")
    requester = await register_user("trans_accept_requester@example.com", "Requester")
    book_id = await create_book(owner["headers"])
    exchange_id = await _create_exchange(client, requester, book_id)

    resp = await client.post(
        f"/api/v1/exchanges/{exchange_id}/accept", headers=owner["headers"]
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "accepted"


@pytest.mark.asyncio
async def test_accept_by_requester_is_wrong_actor(
    client: httpx.AsyncClient, register_user, create_book
) -> None:
    owner = await register_user("trans_wrongactor_owner@example.com", "Owner")
    requester = await register_user("trans_wrongactor_requester@example.com", "Requester")
    book_id = await create_book(owner["headers"])
    exchange_id = await _create_exchange(client, requester, book_id)

    resp = await client.post(
        f"/api/v1/exchanges/{exchange_id}/accept", headers=requester["headers"]
    )
    assert resp.status_code == 409
    assert resp.json()["detail"] == "WRONG_ACTOR"


@pytest.mark.asyncio
async def test_accept_by_non_participant_returns_404(
    client: httpx.AsyncClient, register_user, create_book
) -> None:
    owner = await register_user("trans_stranger_owner@example.com", "Owner")
    requester = await register_user("trans_stranger_requester@example.com", "Requester")
    stranger = await register_user("trans_stranger@example.com", "Stranger")
    book_id = await create_book(owner["headers"])
    exchange_id = await _create_exchange(client, requester, book_id)

    resp = await client.post(
        f"/api/v1/exchanges/{exchange_id}/accept", headers=stranger["headers"]
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_reject_by_owner_succeeds(
    client: httpx.AsyncClient, register_user, create_book
) -> None:
    owner = await register_user("trans_reject_owner@example.com", "Owner")
    requester = await register_user("trans_reject_requester@example.com", "Requester")
    book_id = await create_book(owner["headers"])
    exchange_id = await _create_exchange(client, requester, book_id)

    resp = await client.post(
        f"/api/v1/exchanges/{exchange_id}/reject", headers=owner["headers"]
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "rejected"


@pytest.mark.asyncio
async def test_reject_by_requester_is_wrong_actor(
    client: httpx.AsyncClient, register_user, create_book
) -> None:
    owner = await register_user("trans_reject_wa_owner@example.com", "Owner")
    requester = await register_user("trans_reject_wa_requester@example.com", "Requester")
    book_id = await create_book(owner["headers"])
    exchange_id = await _create_exchange(client, requester, book_id)

    resp = await client.post(
        f"/api/v1/exchanges/{exchange_id}/reject", headers=requester["headers"]
    )
    assert resp.status_code == 409
    assert resp.json()["detail"] == "WRONG_ACTOR"


@pytest.mark.asyncio
async def test_cancel_by_requester_succeeds(
    client: httpx.AsyncClient, register_user, create_book
) -> None:
    owner = await register_user("trans_cancel_owner@example.com", "Owner")
    requester = await register_user("trans_cancel_requester@example.com", "Requester")
    book_id = await create_book(owner["headers"])
    exchange_id = await _create_exchange(client, requester, book_id)

    resp = await client.post(
        f"/api/v1/exchanges/{exchange_id}/cancel", headers=requester["headers"]
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "cancelled"


@pytest.mark.asyncio
async def test_cancel_by_owner_is_wrong_actor_when_pending(
    client: httpx.AsyncClient, register_user, create_book
) -> None:
    owner = await register_user("trans_cancel_wa_owner@example.com", "Owner")
    requester = await register_user("trans_cancel_wa_requester@example.com", "Requester")
    book_id = await create_book(owner["headers"])
    exchange_id = await _create_exchange(client, requester, book_id)

    resp = await client.post(
        f"/api/v1/exchanges/{exchange_id}/cancel", headers=owner["headers"]
    )
    assert resp.status_code == 409
    assert resp.json()["detail"] == "WRONG_ACTOR"


@pytest.mark.asyncio
async def test_cancel_by_either_party_when_accepted(
    client: httpx.AsyncClient, register_user, create_book
) -> None:
    owner = await register_user("trans_cancel_acc_owner@example.com", "Owner")
    requester = await register_user("trans_cancel_acc_requester@example.com", "Requester")
    book_id = await create_book(owner["headers"])
    exchange_id = await _create_exchange(client, requester, book_id)

    accept_resp = await client.post(
        f"/api/v1/exchanges/{exchange_id}/accept", headers=owner["headers"]
    )
    assert accept_resp.status_code == 200

    # Now the owner (not just the requester) is allowed to cancel.
    resp = await client.post(
        f"/api/v1/exchanges/{exchange_id}/cancel", headers=owner["headers"]
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "cancelled"


@pytest.mark.asyncio
async def test_illegal_transition_on_terminal_status(
    client: httpx.AsyncClient, register_user, create_book
) -> None:
    owner = await register_user("trans_illegal_owner@example.com", "Owner")
    requester = await register_user("trans_illegal_requester@example.com", "Requester")
    book_id = await create_book(owner["headers"])
    exchange_id = await _create_exchange(client, requester, book_id)

    reject_resp = await client.post(
        f"/api/v1/exchanges/{exchange_id}/reject", headers=owner["headers"]
    )
    assert reject_resp.status_code == 200

    # A rejected request can no longer be accepted.
    resp = await client.post(
        f"/api/v1/exchanges/{exchange_id}/accept", headers=owner["headers"]
    )
    assert resp.status_code == 409
    assert resp.json()["detail"] == "INVALID_TRANSITION"


@pytest.mark.asyncio
async def test_complete_then_confirm_by_other_party(
    client: httpx.AsyncClient, register_user, create_book
) -> None:
    owner = await register_user("trans_complete_owner@example.com", "Owner")
    requester = await register_user("trans_complete_requester@example.com", "Requester")
    book_id = await create_book(owner["headers"])
    exchange_id = await _create_exchange(client, requester, book_id)

    await client.post(f"/api/v1/exchanges/{exchange_id}/accept", headers=owner["headers"])

    complete_resp = await client.post(
        f"/api/v1/exchanges/{exchange_id}/complete", headers=requester["headers"]
    )
    assert complete_resp.status_code == 200
    assert complete_resp.json()["status"] == "completion_pending"
    assert complete_resp.json()["completion_marked_by"] == requester["user_id"]

    # The same party cannot confirm their own completion.
    self_confirm = await client.post(
        f"/api/v1/exchanges/{exchange_id}/confirm-completion", headers=requester["headers"]
    )
    assert self_confirm.status_code == 409
    assert self_confirm.json()["detail"] == "WRONG_ACTOR"

    confirm_resp = await client.post(
        f"/api/v1/exchanges/{exchange_id}/confirm-completion", headers=owner["headers"]
    )
    assert confirm_resp.status_code == 200
    assert confirm_resp.json()["status"] == "completed"
