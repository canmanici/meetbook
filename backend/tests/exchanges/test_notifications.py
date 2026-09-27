"""Bildirim delivery: who hears about exchange events, push gating, token pruning."""

from typing import Any

import httpx
import pytest
from sqlalchemy import select

import app.modules.push_tokens.service as push_service
from app.modules.push_tokens.models import PushToken


@pytest.fixture
def sent_pushes(monkeypatch: pytest.MonkeyPatch) -> list[dict[str, Any]]:
    """Capture pushes instead of calling Expo; tokens ending in 'dead' are
    reported as DeviceNotRegistered."""
    sent: list[dict[str, Any]] = []

    async def fake_send(tokens: list[str], message: push_service.PushMessage) -> dict[str, Any]:
        sent.append({"tokens": tokens, "title": message.title, "data": message.data})
        dead = [t for t in tokens if t.endswith("dead]")]
        return {"ok": len(tokens) - len(dead), "errors": [], "invalid_tokens": dead}

    monkeypatch.setattr(push_service, "send_push", fake_send)
    return sent


async def _notifications(client: httpx.AsyncClient, user: dict) -> list[dict[str, Any]]:
    resp = await client.get("/api/v1/notifications", headers=user["headers"])
    assert resp.status_code == 200
    return resp.json()["items"]


async def _request(client: httpx.AsyncClient, requester: dict, book_id: str) -> str:
    resp = await client.post(
        "/api/v1/exchanges",
        json={"book_id": book_id, "initial_message": "Hi"},
        headers=requester["headers"],
    )
    assert resp.status_code == 201
    return resp.json()["id"]


async def _register_token(client: httpx.AsyncClient, user: dict, token: str) -> None:
    resp = await client.post(
        "/api/v1/auth/push-token",
        json={"token": token, "platform": "android"},
        headers=user["headers"],
    )
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_new_request_notifies_owner_with_push(
    client: httpx.AsyncClient, register_user, create_book, sent_pushes
) -> None:
    owner = await register_user("notif_owner@example.com", "Owner")
    requester = await register_user("notif_req@example.com", "Ayşe")
    await _register_token(client, owner, "ExponentPushToken[owner]")
    book_id = await create_book(owner["headers"])

    exchange_id = await _request(client, requester, book_id)

    items = await _notifications(client, owner)
    assert [n["type"] for n in items] == ["exchange_request"]
    assert items[0]["payload"]["exchange_id"] == exchange_id
    assert "Ayşe" in items[0]["payload"]["message"]
    assert sent_pushes[0]["tokens"] == ["ExponentPushToken[owner]"]
    assert sent_pushes[0]["data"]["notification_id"] == items[0]["id"]
    assert sent_pushes[0]["data"]["exchange_id"] == exchange_id


@pytest.mark.asyncio
async def test_reject_before_accept_still_tells_requester(
    client: httpx.AsyncClient, register_user, create_book, sent_pushes
) -> None:
    owner = await register_user("notif_rej_owner@example.com", "Owner")
    requester = await register_user("notif_rej_req@example.com", "Requester")
    book_id = await create_book(owner["headers"])
    exchange_id = await _request(client, requester, book_id)

    resp = await client.post(f"/api/v1/exchanges/{exchange_id}/reject", headers=owner["headers"])
    assert resp.status_code == 200

    items = await _notifications(client, requester)
    assert len(items) == 1
    assert items[0]["type"] == "chat_system"
    assert items[0]["payload"]["action"] == "exchange_rejected"
    assert items[0]["payload"]["title"] == "Owner"


@pytest.mark.asyncio
async def test_disabled_preference_mutes_push_but_keeps_bell_entry(
    client: httpx.AsyncClient, register_user, create_book, sent_pushes
) -> None:
    owner = await register_user("notif_mute_owner@example.com", "Owner")
    requester = await register_user("notif_mute_req@example.com", "Requester")
    await _register_token(client, owner, "ExponentPushToken[muted]")
    resp = await client.patch(
        "/api/v1/auth/me",
        json={"notification_settings": {"new_exchange_request": False}},
        headers=owner["headers"],
    )
    assert resp.status_code == 200
    book_id = await create_book(owner["headers"])

    await _request(client, requester, book_id)

    assert [n["type"] for n in await _notifications(client, owner)] == ["exchange_request"]
    assert sent_pushes == []


@pytest.mark.asyncio
async def test_dead_tokens_are_pruned(
    client: httpx.AsyncClient, register_user, create_book, sent_pushes, db_session
) -> None:
    owner = await register_user("notif_prune_owner@example.com", "Owner")
    requester = await register_user("notif_prune_req@example.com", "Requester")
    await _register_token(client, owner, "ExponentPushToken[dead]")
    book_id = await create_book(owner["headers"])

    await _request(client, requester, book_id)

    assert sent_pushes[0]["tokens"] == ["ExponentPushToken[dead]"]
    rows = await db_session.execute(select(PushToken).where(PushToken.token.like("%dead%")))
    assert rows.scalars().all() == []


@pytest.mark.asyncio
async def test_mark_all_read(
    client: httpx.AsyncClient, register_user, create_book, sent_pushes
) -> None:
    owner = await register_user("notif_all_owner@example.com", "Owner")
    book_id = await create_book(owner["headers"])
    for i in range(2):
        requester = await register_user(f"notif_all_req{i}@example.com", f"R{i}")
        await _request(client, requester, book_id)

    assert sum(n["read_at"] is None for n in await _notifications(client, owner)) == 2
    resp = await client.post("/api/v1/notifications/read-all", headers=owner["headers"])
    assert resp.status_code == 204
    assert all(n["read_at"] for n in await _notifications(client, owner))
