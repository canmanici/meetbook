"""WebSocket fan-out: concurrent sends, a stalled socket can't block others."""

import asyncio
import time
import uuid
from typing import Any

import pytest

import app.modules.chat.service as chat_service


class _Sock:
    def __init__(self, delay: float = 0.0) -> None:
        self.delay = delay
        self.sent: list[str] = []
        self.closed = False

    async def send_text(self, text: str) -> None:
        await asyncio.sleep(self.delay)
        self.sent.append(text)

    async def close(self, code: int = 1000) -> None:
        self.closed = True


async def test_stalled_socket_is_dropped_without_blocking_others(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(chat_service, "WS_SEND_TIMEOUT_SECONDS", 0.05)
    uid = uuid.uuid4()
    fast, stalled = _Sock(), _Sock(delay=10)
    chat_service._connections[uid] = {fast, stalled}  # type: ignore[arg-type]

    t = time.perf_counter()
    await chat_service.ConnectionManager.send_to_user(uid, {"type": "x"})
    assert time.perf_counter() - t < 1.0
    assert fast.sent == ['{"type": "x"}']
    assert chat_service._connections[uid] == {fast}  # stalled one removed
    await asyncio.sleep(0.01)
    assert stalled.closed  # and closed so the client reconnects


async def test_broadcast_uses_cached_participants_without_repo(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    a, b, chat_id = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    chat_service._chat_participants.set(chat_id, (a, b))
    got: list[tuple[uuid.UUID, Any]] = []

    async def send_to_user(uid: uuid.UUID, payload: dict[str, Any]) -> None:
        got.append((uid, payload))

    monkeypatch.setattr(chat_service.ConnectionManager, "send_to_user", send_to_user)
    await chat_service.ConnectionManager.broadcast_to_chat(chat_id, {"k": 1}, exclude_user_id=a)
    assert got == [(b, {"k": 1})]
