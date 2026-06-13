import httpx
import pytest

from tests.exchanges.conftest import ISTANBUL, KADIKOY_CAFE, RHODES


async def _create_accepted_exchange(
    client: httpx.AsyncClient, requester: dict, owner: dict, book_id: str
) -> str:
    resp = await client.post(
        "/api/v1/exchanges",
        json={"book_id": book_id, "initial_message": "Hi"},
        headers=requester["headers"],
    )
    assert resp.status_code == 201
    exchange_id = resp.json()["id"]

    accept_resp = await client.post(
        f"/api/v1/exchanges/{exchange_id}/accept", headers=owner["headers"]
    )
    assert accept_resp.status_code == 200
    return exchange_id


@pytest.mark.asyncio
async def test_propose_meetup_safe_category_is_auto_confirmed(
    client: httpx.AsyncClient, register_user, create_book, seed_turkey_boundary
) -> None:
    owner = await register_user("meetup_safe_owner@example.com", "Owner")
    requester = await register_user("meetup_safe_requester@example.com", "Requester")
    book_id = await create_book(owner["headers"])
    exchange_id = await _create_accepted_exchange(client, requester, owner, book_id)

    resp = await client.post(
        f"/api/v1/exchanges/{exchange_id}/meetup",
        json={
            "place_name": "Kadikoy Cafe",
            "category": "cafe",
            "lat": KADIKOY_CAFE["lat"],
            "lng": KADIKOY_CAFE["lng"],
            "scheduled_at": "2026-07-01T12:00:00Z",
        },
        headers=requester["headers"],
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "meetup_proposed"
    assert body["meetup"]["validation_status"] == "auto"
    assert body["meetup"]["can_confirm"] is True
    assert body["meetup"]["requires_acknowledgment"] is False


@pytest.mark.asyncio
async def test_propose_meetup_manual_pin_is_warning_and_requires_double_ack(
    client: httpx.AsyncClient, register_user, create_book, seed_turkey_boundary
) -> None:
    owner = await register_user("meetup_warn_owner@example.com", "Owner")
    requester = await register_user("meetup_warn_requester@example.com", "Requester")
    book_id = await create_book(owner["headers"])
    exchange_id = await _create_accepted_exchange(client, requester, owner, book_id)

    propose_resp = await client.post(
        f"/api/v1/exchanges/{exchange_id}/meetup",
        json={
            "place_name": "Manual pin",
            "category": None,
            "lat": KADIKOY_CAFE["lat"],
            "lng": KADIKOY_CAFE["lng"],
            "scheduled_at": "2026-07-01T12:00:00Z",
        },
        headers=requester["headers"],
    )
    assert propose_resp.status_code == 200
    meetup = propose_resp.json()["meetup"]
    assert meetup["validation_status"] == "warning"
    assert meetup["proposer_acknowledged"] is False
    assert meetup["other_acknowledged"] is False
    assert meetup["requires_acknowledgment"] is True
    assert meetup["can_confirm"] is False

    # Without any acknowledgment, the other party can't accept the meetup.
    accept_resp = await client.post(
        f"/api/v1/exchanges/{exchange_id}/meetup/accept",
        json={"acknowledge_warning": False},
        headers=owner["headers"],
    )
    assert accept_resp.status_code == 400
    assert accept_resp.json()["detail"] == "ACKNOWLEDGMENT_REQUIRED"


@pytest.mark.asyncio
async def test_accept_meetup_with_acknowledgment_confirms(
    client: httpx.AsyncClient, register_user, create_book, seed_turkey_boundary
) -> None:
    owner = await register_user("meetup_accept_owner@example.com", "Owner")
    requester = await register_user("meetup_accept_requester@example.com", "Requester")
    book_id = await create_book(owner["headers"])
    exchange_id = await _create_accepted_exchange(client, requester, owner, book_id)

    propose_resp = await client.post(
        f"/api/v1/exchanges/{exchange_id}/meetup",
        json={
            "place_name": "Manual pin",
            "category": None,
            "lat": KADIKOY_CAFE["lat"],
            "lng": KADIKOY_CAFE["lng"],
            "scheduled_at": "2026-07-01T12:00:00Z",
            "acknowledge_warning": True,
        },
        headers=requester["headers"],
    )
    assert propose_resp.json()["meetup"]["proposer_acknowledged"] is True

    accept_resp = await client.post(
        f"/api/v1/exchanges/{exchange_id}/meetup/accept",
        json={"acknowledge_warning": True},
        headers=owner["headers"],
    )
    assert accept_resp.status_code == 200
    body = accept_resp.json()
    assert body["status"] == "meetup_confirmed"
    assert body["meetup"]["other_acknowledged"] is True
    assert body["meetup"]["can_confirm"] is True


@pytest.mark.asyncio
async def test_accept_own_proposal_rejected(
    client: httpx.AsyncClient, register_user, create_book, seed_turkey_boundary
) -> None:
    owner = await register_user("meetup_self_owner@example.com", "Owner")
    requester = await register_user("meetup_self_requester@example.com", "Requester")
    book_id = await create_book(owner["headers"])
    exchange_id = await _create_accepted_exchange(client, requester, owner, book_id)

    await client.post(
        f"/api/v1/exchanges/{exchange_id}/meetup",
        json={
            "place_name": "Kadikoy Cafe",
            "category": "cafe",
            "lat": KADIKOY_CAFE["lat"],
            "lng": KADIKOY_CAFE["lng"],
            "scheduled_at": "2026-07-01T12:00:00Z",
        },
        headers=requester["headers"],
    )

    resp = await client.post(
        f"/api/v1/exchanges/{exchange_id}/meetup/accept",
        json={},
        headers=requester["headers"],
    )
    assert resp.status_code == 409
    assert resp.json()["detail"] == "ACCEPT_OWN_PROPOSAL"


@pytest.mark.asyncio
async def test_reject_meetup_returns_to_accepted(
    client: httpx.AsyncClient, register_user, create_book, seed_turkey_boundary
) -> None:
    owner = await register_user("meetup_reject_owner@example.com", "Owner")
    requester = await register_user("meetup_reject_requester@example.com", "Requester")
    book_id = await create_book(owner["headers"])
    exchange_id = await _create_accepted_exchange(client, requester, owner, book_id)

    await client.post(
        f"/api/v1/exchanges/{exchange_id}/meetup",
        json={
            "place_name": "Kadikoy Cafe",
            "category": "cafe",
            "lat": KADIKOY_CAFE["lat"],
            "lng": KADIKOY_CAFE["lng"],
            "scheduled_at": "2026-07-01T12:00:00Z",
        },
        headers=requester["headers"],
    )

    resp = await client.post(
        f"/api/v1/exchanges/{exchange_id}/meetup/reject", headers=owner["headers"]
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "accepted"


@pytest.mark.asyncio
async def test_reschedule_resets_acknowledgments(
    client: httpx.AsyncClient, register_user, create_book, seed_turkey_boundary
) -> None:
    owner = await register_user("meetup_resched_owner@example.com", "Owner")
    requester = await register_user("meetup_resched_requester@example.com", "Requester")
    book_id = await create_book(owner["headers"])
    exchange_id = await _create_accepted_exchange(client, requester, owner, book_id)

    await client.post(
        f"/api/v1/exchanges/{exchange_id}/meetup",
        json={
            "place_name": "Manual pin",
            "category": None,
            "lat": KADIKOY_CAFE["lat"],
            "lng": KADIKOY_CAFE["lng"],
            "scheduled_at": "2026-07-01T12:00:00Z",
            "acknowledge_warning": True,
        },
        headers=requester["headers"],
    )
    await client.post(
        f"/api/v1/exchanges/{exchange_id}/meetup/accept",
        json={"acknowledge_warning": True},
        headers=owner["headers"],
    )

    resched_resp = await client.post(
        f"/api/v1/exchanges/{exchange_id}/meetup",
        json={
            "place_name": "Manual pin v2",
            "category": None,
            "lat": KADIKOY_CAFE["lat"],
            "lng": KADIKOY_CAFE["lng"],
            "scheduled_at": "2026-07-02T12:00:00Z",
        },
        headers=requester["headers"],
    )
    assert resched_resp.status_code == 200
    body = resched_resp.json()
    assert body["status"] == "meetup_proposed"
    assert body["meetup"]["proposer_acknowledged"] is False
    assert body["meetup"]["other_acknowledged"] is False


@pytest.mark.asyncio
async def test_propose_meetup_outside_turkey_rejected(
    client: httpx.AsyncClient, register_user, create_book, seed_turkey_boundary
) -> None:
    owner = await register_user("meetup_geo_owner@example.com", "Owner")
    requester = await register_user("meetup_geo_requester@example.com", "Requester")
    book_id = await create_book(owner["headers"])
    exchange_id = await _create_accepted_exchange(client, requester, owner, book_id)

    resp = await client.post(
        f"/api/v1/exchanges/{exchange_id}/meetup",
        json={
            "place_name": "Rhodes Cafe",
            "category": "cafe",
            "lat": RHODES["lat"],
            "lng": RHODES["lng"],
            "scheduled_at": "2026-07-01T12:00:00Z",
        },
        headers=requester["headers"],
    )
    assert resp.status_code == 400
    assert resp.json()["detail"] == "OUTSIDE_TURKEY"


@pytest.mark.asyncio
async def test_propose_meetup_near_blocked_place_rejected(
    client: httpx.AsyncClient, register_user, create_book, seed_turkey_boundary, block_place
) -> None:
    owner = await register_user("meetup_blocked_owner@example.com", "Owner")
    requester = await register_user("meetup_blocked_requester@example.com", "Requester")
    book_id = await create_book(owner["headers"])
    exchange_id = await _create_accepted_exchange(client, requester, owner, book_id)

    await block_place(KADIKOY_CAFE["lat"], KADIKOY_CAFE["lng"])

    resp = await client.post(
        f"/api/v1/exchanges/{exchange_id}/meetup",
        json={
            "place_name": "Blocked place",
            "category": "cafe",
            "lat": KADIKOY_CAFE["lat"],
            "lng": KADIKOY_CAFE["lng"],
            "scheduled_at": "2026-07-01T12:00:00Z",
        },
        headers=requester["headers"],
    )
    assert resp.status_code == 400
    assert resp.json()["detail"] == "BLOCKED_PLACE"


@pytest.mark.asyncio
async def test_propose_meetup_before_accepted_is_invalid_transition(
    client: httpx.AsyncClient, register_user, create_book, seed_turkey_boundary
) -> None:
    owner = await register_user("meetup_pending_owner@example.com", "Owner")
    requester = await register_user("meetup_pending_requester@example.com", "Requester")
    book_id = await create_book(owner["headers"])

    create_resp = await client.post(
        "/api/v1/exchanges",
        json={"book_id": book_id, "initial_message": "Hi"},
        headers=requester["headers"],
    )
    exchange_id = create_resp.json()["id"]

    resp = await client.post(
        f"/api/v1/exchanges/{exchange_id}/meetup",
        json={
            "place_name": "Kadikoy Cafe",
            "category": "cafe",
            "lat": KADIKOY_CAFE["lat"],
            "lng": KADIKOY_CAFE["lng"],
            "scheduled_at": "2026-07-01T12:00:00Z",
        },
        headers=requester["headers"],
    )
    assert resp.status_code == 409
    assert resp.json()["detail"] == "INVALID_TRANSITION"


@pytest.mark.asyncio
async def test_meetup_suggestions_returns_places(
    client: httpx.AsyncClient, register_user, create_book, seed_turkey_boundary
) -> None:
    owner = await register_user("meetup_sugg_owner@example.com", "Owner")
    requester = await register_user("meetup_sugg_requester@example.com", "Requester")
    book_id = await create_book(owner["headers"])
    exchange_id = await _create_accepted_exchange(client, requester, owner, book_id)

    resp = await client.get(
        f"/api/v1/exchanges/{exchange_id}/meetup/suggestions",
        headers=requester["headers"],
    )
    assert resp.status_code == 200
    assert "items" in resp.json()


@pytest.mark.asyncio
async def test_meetup_actions_require_participant(
    client: httpx.AsyncClient, register_user, create_book, seed_turkey_boundary
) -> None:
    owner = await register_user("meetup_stranger_owner@example.com", "Owner")
    requester = await register_user("meetup_stranger_requester@example.com", "Requester")
    stranger = await register_user("meetup_stranger@example.com", "Stranger")
    book_id = await create_book(owner["headers"])
    exchange_id = await _create_accepted_exchange(client, requester, owner, book_id)

    resp = await client.post(
        f"/api/v1/exchanges/{exchange_id}/meetup",
        json={
            "place_name": "Kadikoy Cafe",
            "category": "cafe",
            "lat": KADIKOY_CAFE["lat"],
            "lng": KADIKOY_CAFE["lng"],
            "scheduled_at": "2026-07-01T12:00:00Z",
        },
        headers=stranger["headers"],
    )
    assert resp.status_code == 404
