import time

import pytest

from app.core.ttl_cache import TTLCache


def test_lru_bound_and_ttl(monkeypatch: pytest.MonkeyPatch) -> None:
    c: TTLCache[str, int] = TTLCache(maxsize=2, ttl_seconds=10)
    c.set("a", 1)
    c.set("b", 2)
    assert c.get("a") == 1  # touch a → b is now least recent
    c.set("c", 3)
    assert c.get("b") is None and len(c) == 2

    now = time.monotonic()
    monkeypatch.setattr(time, "monotonic", lambda: now + 11)
    assert c.get("a") is None and c.get("c") is None
