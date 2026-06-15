"""Proof-of-work: double-blind rating lifecycle (Phase 7 DoD)."""

from collections.abc import Awaitable, Callable
from typing import Any

import httpx
import pytest


@pytest.mark.asyncio
async def test_rating_before_completion_rejected(
    client: httpx.AsyncClient,
    accepted_exchange: Callable[[], Awaitable[dict[str, Any]]],
) -> None:
    exchange = await accepted_exchange()

    resp = await client.post(
        "/api/v1/ratings",
        json={"exchange_id": exchange["exchange_id"], "score": 5, "comment": "Great!"},
        headers=exchange["requester"]["headers"],
    )

    assert resp.status_code == 409
    assert resp.json()["detail"] == "EXCHANGE_NOT_COMPLETED"


@pytest.mark.asyncio
async def test_second_rating_rejected(
    client: httpx.AsyncClient,
    completed_exchange: Callable[[], Awaitable[dict[str, Any]]],
) -> None:
    exchange = await completed_exchange()

    first = await client.post(
        "/api/v1/ratings",
        json={"exchange_id": exchange["exchange_id"], "score": 5, "comment": "Great!"},
        headers=exchange["requester"]["headers"],
    )
    assert first.status_code == 201

    second = await client.post(
        "/api/v1/ratings",
        json={"exchange_id": exchange["exchange_id"], "score": 1, "comment": "Changed my mind"},
        headers=exchange["requester"]["headers"],
    )
    assert second.status_code == 409
    assert second.json()["detail"] == "ALREADY_RATED"


@pytest.mark.asyncio
async def test_ratings_hidden_until_both_submitted(
    client: httpx.AsyncClient,
    completed_exchange: Callable[[], Awaitable[dict[str, Any]]],
) -> None:
    exchange = await completed_exchange()
    owner = exchange["owner"]
    requester = exchange["requester"]

    # Only the requester rates the owner — the owner's rating list should be empty.
    resp = await client.post(
        "/api/v1/ratings",
        json={"exchange_id": exchange["exchange_id"], "score": 4, "comment": "Nice owner"},
        headers=requester["headers"],
    )
    assert resp.status_code == 201

    hidden = await client.get(
        f"/api/v1/users/{owner['user_id']}/ratings", headers=requester["headers"]
    )
    assert hidden.status_code == 200
    body = hidden.json()
    assert body["items"] == []
    assert body["rating_count"] == 0

    # Now the owner rates back — both ratings should reveal and aggregates update.
    resp2 = await client.post(
        "/api/v1/ratings",
        json={"exchange_id": exchange["exchange_id"], "score": 2, "comment": "Slow requester"},
        headers=owner["headers"],
    )
    assert resp2.status_code == 201

    revealed_owner = await client.get(
        f"/api/v1/users/{owner['user_id']}/ratings", headers=requester["headers"]
    )
    assert revealed_owner.status_code == 200
    body = revealed_owner.json()
    assert len(body["items"]) == 1
    assert body["items"][0]["score"] == 4
    assert body["rating_count"] == 1
    assert body["rating_average"] == 4.0

    revealed_requester = await client.get(
        f"/api/v1/users/{requester['user_id']}/ratings", headers=owner["headers"]
    )
    body = revealed_requester.json()
    assert len(body["items"]) == 1
    assert body["items"][0]["score"] == 2
    assert body["rating_count"] == 1
    assert body["rating_average"] == 2.0
