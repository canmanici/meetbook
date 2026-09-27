"""Tiny bounded TTL + LRU cache for in-process memoisation.

Plain module-level dicts used as caches grow for the life of the process
(one entry per distinct key ever seen). This one caps both age and size.
Not thread-safe; meant for the single asyncio event loop.
"""

import time
from collections import OrderedDict

_MISSING = object()


class TTLCache[K, V]:
    def __init__(self, maxsize: int, ttl_seconds: float) -> None:
        self.maxsize = maxsize
        self.ttl = ttl_seconds
        self._data: OrderedDict[K, tuple[float, V]] = OrderedDict()

    def get(self, key: K, default: V | None = None) -> V | None:
        item = self._data.get(key, _MISSING)
        if item is _MISSING:
            return default
        expires, value = item  # type: ignore[misc]
        if expires <= time.monotonic():
            del self._data[key]
            return default
        self._data.move_to_end(key)
        return value

    def set(self, key: K, value: V, ttl_seconds: float | None = None) -> None:
        ttl = self.ttl if ttl_seconds is None else ttl_seconds
        self._data[key] = (time.monotonic() + ttl, value)
        self._data.move_to_end(key)
        while len(self._data) > self.maxsize:
            self._data.popitem(last=False)

    def pop(self, key: K, default: V | None = None) -> V | None:
        item = self._data.pop(key, None)
        return default if item is None else item[1]

    def clear(self) -> None:
        self._data.clear()

    def __contains__(self, key: object) -> bool:
        return self.get(key) is not None  # type: ignore[arg-type]

    def __len__(self) -> int:
        return len(self._data)
