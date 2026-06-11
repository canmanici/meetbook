"""Login throttling tests."""

import httpx
import pytest
from unittest.mock import AsyncMock, patch

from app.core.throttle import LoginThrottle
from app.main import create_app


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


@pytest.mark.anyio
async def test_throttle_allows_first_attempts() -> None:
    """First 5 attempts should be allowed."""
    throttle = LoginThrottle(AsyncMock())
    throttle._redis = AsyncMock()
    throttle._redis.zcard = AsyncMock(return_value=0)

    allowed, retry_after = await throttle.check("test@email.com", "127.0.0.1")
    assert allowed is True
    assert retry_after is None


@pytest.mark.anyio
async def test_throttle_blocks_after_limit() -> None:
    """6th attempt should be blocked."""
    throttle = LoginThrottle(AsyncMock())
    throttle._redis = AsyncMock()
    throttle._redis.zcard = AsyncMock(return_value=5)
    throttle._redis.zrangebyscore = AsyncMock(return_value=[b"1", b"2", b"3", b"4", b"5"])

    allowed, retry_after = await throttle.check("test@email.com", "127.0.0.1")
    assert allowed is False
    assert retry_after is not None
    assert retry_after > 0


@pytest.mark.anyio
async def test_throttle_records_failure() -> None:
    """Recording a failure should add to sorted set."""
    throttle = LoginThrottle(AsyncMock())
    throttle._redis = AsyncMock()
    throttle._redis.zadd = AsyncMock()
    throttle._redis.expire = AsyncMock()

    await throttle.record_failure("test@email.com", "127.0.0.1")
    throttle._redis.zadd.assert_called_once()
    throttle._redis.expire.assert_called_once()
