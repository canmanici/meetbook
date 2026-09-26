"""Shared async Redis client dependency."""

import hashlib
import json
from typing import Any

import redis.asyncio as aioredis

from app.core.config import get_settings

_redis: aioredis.Redis | None = None


def get_redis() -> aioredis.Redis:
    global _redis
    if _redis is None:
        _redis = aioredis.from_url(get_settings().redis_url)
    return _redis


async def get_cached(key: str) -> bytes | None:
    try:
        value = await get_redis().get(key)
        return value.encode() if isinstance(value, str) else value
    except Exception:
        return None


async def set_cached(key: str, value: Any, ttl_seconds: int = 60) -> None:
    try:
        await get_redis().setex(key, ttl_seconds, json.dumps(value, default=str))
    except Exception:
        pass


def bbox_cache_key(
    min_lat: float,
    max_lat: float,
    min_lng: float,
    max_lng: float,
    category: str | None,
    language: str | None,
    condition: str | None,
    q: str | None,
    limit: int,
) -> str:
    raw = f"{min_lat:.4f}|{max_lat:.4f}|{min_lng:.4f}|{max_lng:.4f}|{category}|{language}|{condition}|{q}|{limit}"
    digest = hashlib.md5(raw.encode(), usedforsecurity=False).hexdigest()
    return f"bbox:{digest}"
