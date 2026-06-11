"""Rate limit middleware tests."""

from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest
from fastapi import FastAPI

from app.core.rate_limit import RateLimitConfig, RateLimitMiddleware


def _build_test_app(mock_redis: MagicMock) -> FastAPI:
    """Create a minimal app with rate limiting middleware for testing."""
    app = FastAPI()

    @app.get("/ping")
    async def ping() -> dict[str, str]:
        return {"msg": "pong"}

    config = RateLimitConfig(requests_per_minute=5)
    app.add_middleware(RateLimitMiddleware, redis_client=mock_redis, config=config)
    return app


def _make_mock_redis() -> MagicMock:
    mock_pipeline = MagicMock()
    mock_pipeline.zremrangebyscore.return_value = 0
    mock_pipeline.zadd.return_value = 1
    mock_pipeline.zcard.return_value = 0
    mock_pipeline.expire.return_value = True
    mock_pipeline.execute = AsyncMock(return_value=[0, 1, 0, True])

    mock_redis = MagicMock()
    mock_redis.pipeline.return_value = mock_pipeline
    mock_redis.zcard = AsyncMock(return_value=0)
    mock_redis.zrem = AsyncMock(return_value=0)
    mock_redis.zrangebyscore = AsyncMock(return_value=[])
    return mock_redis


@pytest.mark.anyio
async def test_rate_limit_allows_normal_requests() -> None:
    """Normal requests within limit should pass."""
    mock_redis = _make_mock_redis()
    app = _build_test_app(mock_redis)
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/ping")
    assert resp.status_code == 200


@pytest.mark.anyio
async def test_rate_limit_headers_present() -> None:
    """Responses should include rate limit headers."""
    mock_redis = _make_mock_redis()
    app = _build_test_app(mock_redis)
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/ping")
    assert "X-RateLimit-Limit" in resp.headers
    assert "X-RateLimit-Remaining" in resp.headers
