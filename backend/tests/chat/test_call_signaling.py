"""Call signaling + message send logic (ChatService.handle_call / handle_send).

Repo, Redis, pub/sub and push are faked so these run without the DB."""

import asyncio
import json
import uuid
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

import app.modules.chat.service as chat_service
from app.modules.chat.service import ChatService

CALLER = uuid.uuid4()
CALLEE = uuid.uuid4()
CHAT = uuid.uuid4()


class FakeRedis:
    def __init__(self) -> None:
        self.data: dict[str, str] = {}

    async def get(self, key: str) -> str | None:
        return self.data.get(key)

    async def set(self, key: str, value: str, ex: int | None = None, nx: bool = False) -> Any:
        if nx and key in self.data:
            return None
        self.data[key] = value
        return True

    async def setex(self, key: str, ttl: int, value: str) -> bool:
        self.data[key] = value
        return True


class FakeWS:
    def __init__(self) -> None:
        self.sent: list[dict[str, Any]] = []

    async def send_text(self, text: str) -> None:
        self.sent.append(json.loads(text))


@pytest.fixture
def env(monkeypatch: pytest.MonkeyPatch) -> SimpleNamespace:
    redis = FakeRedis()
    monkeypatch.setattr(chat_service, "_get_redis", AsyncMock(return_value=redis))
    monkeypatch.setattr(chat_service, "publish_message", AsyncMock())
    push = AsyncMock()
    monkeypatch.setattr(chat_service, "send_push_to_user", push)
    monkeypatch.setattr(
        chat_service,
        "_to_view",
        lambda msg, *_: SimpleNamespace(model_dump=lambda **_: {"id": "m1"}),
    )
    online: set[uuid.UUID] = set()

    async def check_online(uid: uuid.UUID) -> bool:
        return uid in online

    monkeypatch.setattr(chat_service.ConnectionManager, "check_online", check_online)
    chat_service._pending_calls.clear()
    chat_service._call_peer_cache.clear()

    from app.modules.auth.repository import AuthRepository

    monkeypatch.setattr(
        AuthRepository, "get_user_by_id", AsyncMock(return_value=SimpleNamespace(name="Emir"))
    )

    exchange = SimpleNamespace(id=uuid.uuid4(), requested_by=CALLER, requested_to=CALLEE)
    repo = MagicMock()
    repo.is_participant = AsyncMock(return_value=True)
    repo.get_exchange_for_chat = AsyncMock(return_value=exchange)
    repo.is_blocked = AsyncMock(return_value=False)
    repo.create_message = AsyncMock(return_value=SimpleNamespace())
    repo.get_chat_settings = AsyncMock(return_value=None)
    session = MagicMock()
    session.commit = AsyncMock()
    svc = ChatService(session)
    svc.repo = repo
    return SimpleNamespace(svc=svc, repo=repo, redis=redis, push=push, online=online)


def _call(event: str, call_id: str = "c1", **extra: Any) -> dict[str, Any]:
    return {
        "type": "call",
        "event": event,
        "chat_id": str(CHAT),
        "call_id": call_id,
        "kind": "audio",
        **extra,
    }


async def test_call_log_without_a_real_call_is_ignored(env: SimpleNamespace) -> None:
    await env.svc.handle_call(
        CALLER, FakeWS(), _call("end", log={"status": "ended", "duration_seconds": 18000})
    )
    env.repo.create_message.assert_not_awaited()


async def test_call_log_written_once_and_duration_bounded(env: SimpleNamespace) -> None:
    env.online.add(CALLEE)
    await env.svc.handle_call(CALLER, FakeWS(), _call("offer", payload={"sdp": "x"}))
    await env.svc.handle_call(CALLEE, FakeWS(), _call("answer", payload={"sdp": "y"}))
    log = {"status": "ended", "duration_seconds": 18000}
    await env.svc.handle_call(CALLER, FakeWS(), _call("end", log=log))
    await env.svc.handle_call(CALLEE, FakeWS(), _call("end", log=log))

    assert env.repo.create_message.await_count == 1
    extra = env.repo.create_message.await_args.args[5]
    assert extra["status"] == "ended"
    assert extra["duration_seconds"] <= 10  # server saw it answered just now


async def test_unanswered_call_cannot_be_logged_as_ended(env: SimpleNamespace) -> None:
    env.online.add(CALLEE)
    await env.svc.handle_call(CALLER, FakeWS(), _call("offer", payload={"sdp": "x"}))
    await env.svc.handle_call(
        CALLER, FakeWS(), _call("cancel", log={"status": "ended", "duration_seconds": 99})
    )
    extra = env.repo.create_message.await_args.args[5]
    assert extra["status"] == "missed"
    assert extra["duration_seconds"] == 0


async def test_grace_window_does_not_ring_a_cancelled_call(
    env: SimpleNamespace, monkeypatch: pytest.MonkeyPatch
) -> None:
    real_sleep = asyncio.sleep
    monkeypatch.setattr(chat_service.asyncio, "sleep", lambda _s: real_sleep(0))
    delivered: list[dict[str, Any]] = []

    async def send_to_user(uid: uuid.UUID, payload: dict[str, Any]) -> None:
        if uid == CALLEE and uid in env.online:
            delivered.append(payload)

    monkeypatch.setattr(chat_service.ConnectionManager, "send_to_user", send_to_user)

    await env.svc.handle_call(CALLER, FakeWS(), _call("offer", payload={"sdp": "x"}))
    env.push.assert_awaited_once()
    await env.svc.handle_call(CALLER, FakeWS(), _call("cancel"))
    env.online.add(CALLEE)  # callee opens the app after the cancel
    await asyncio.gather(*list(chat_service._background_tasks))

    assert delivered == []
    assert "c1" not in chat_service._pending_calls


async def test_grace_window_redelivers_offer_with_buffered_ice(
    env: SimpleNamespace, monkeypatch: pytest.MonkeyPatch
) -> None:
    real_sleep = asyncio.sleep
    monkeypatch.setattr(chat_service.asyncio, "sleep", lambda _s: real_sleep(0))
    delivered: list[dict[str, Any]] = []

    async def send_to_user(uid: uuid.UUID, payload: dict[str, Any]) -> None:
        if uid == CALLEE and uid in env.online:
            delivered.append(payload)

    monkeypatch.setattr(chat_service.ConnectionManager, "send_to_user", send_to_user)

    await env.svc.handle_call(CALLER, FakeWS(), _call("offer", payload={"sdp": "x"}))
    await env.svc.handle_call(CALLER, FakeWS(), _call("ice", payload={"candidate": "a"}))
    await env.svc.handle_call(CALLER, FakeWS(), _call("ice", payload={"candidate": "b"}))
    env.online.add(CALLEE)
    await asyncio.gather(*list(chat_service._background_tasks))

    assert [p["event"] for p in delivered] == ["offer", "ice", "ice"]


async def test_send_echoes_client_id_and_errors_carry_it(
    env: SimpleNamespace, monkeypatch: pytest.MonkeyPatch
) -> None:
    broadcasts: list[dict[str, Any]] = []

    async def broadcast(chat_id: uuid.UUID, payload: dict[str, Any], **_: Any) -> None:
        broadcasts.append(payload)

    monkeypatch.setattr(chat_service.ConnectionManager, "broadcast_to_chat", broadcast)
    monkeypatch.setattr(chat_service, "NotificationService", MagicMock())
    env.repo.create_message = AsyncMock(return_value=SimpleNamespace(sender_id=CALLER, text="hi"))
    await env.svc.handle_send(CALLER, FakeWS(), CHAT, "hi", client_id="temp-1")
    assert broadcasts[0]["client_id"] == "temp-1"

    env.repo.is_blocked = AsyncMock(return_value=True)
    ws = FakeWS()
    await env.svc.handle_send(CALLER, ws, CHAT, "hi", client_id="temp-2")
    assert ws.sent == [
        {"type": "error", "error": "Cannot send message — user is blocked", "client_id": "temp-2"}
    ]


async def test_muted_chat_gets_no_push(
    env: SimpleNamespace, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(chat_service.ConnectionManager, "broadcast_to_chat", AsyncMock())
    notif = MagicMock()
    notif.return_value.notify = AsyncMock()
    monkeypatch.setattr(chat_service, "NotificationService", notif)
    env.repo.create_message = AsyncMock(return_value=SimpleNamespace(sender_id=CALLER))
    env.repo.get_chat_settings = AsyncMock(
        return_value=SimpleNamespace(is_muted=True, muted_until=None)
    )
    await env.svc.handle_send(CALLER, FakeWS(), CHAT, "hi")
    env.push.assert_not_awaited()
    notif.return_value.notify.assert_not_awaited()
