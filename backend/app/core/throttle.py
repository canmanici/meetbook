"""Login throttling — Redis sliding window with exponential backoff."""

import time

import redis.asyncio as aioredis

from app.core.security import hash_token


class LoginThrottle:
    WINDOW_SECONDS = 15 * 60  # 15 minutes
    MAX_FAILURES = 5
    BASE_BACKOFF = 60  # 1 minute base backoff

    def __init__(self, redis_client: aioredis.Redis) -> None:
        self._redis = redis_client

    def _key(self, email: str, ip: str) -> str:
        email_hash = hash_token(email)[:16]
        return f"throttle:login:{email_hash}:{ip}"

    async def check(self, email: str, ip: str) -> tuple[bool, int | None]:
        """Return (allowed, retry_after_seconds)."""
        key = self._key(email, ip)
        now = time.time()
        window_start = now - self.WINDOW_SECONDS

        # Remove old entries
        await self._redis.zremrangebyscore(key, 0, window_start)

        # Count failures in window
        count = await self._redis.zcard(key)

        if count < self.MAX_FAILURES:
            return True, None

        # Calculate backoff: exponential from base
        backoff = self.BASE_BACKOFF * (2 ** (count - self.MAX_FAILURES))
        backoff = min(backoff, 16 * 60)  # Cap at 16 minutes

        # Get oldest failure in window to calculate retry-after
        oldest = await self._redis.zrangebyscore(key, window_start, now, start=0, num=1)
        if oldest:
            first = oldest[0]
            oldest_time = float(first.decode() if isinstance(first, bytes) else str(first))
            retry_after = int(oldest_time + backoff - now)
            return False, max(retry_after, 1)

        return False, backoff

    async def record_failure(self, email: str, ip: str) -> None:
        key = self._key(email, ip)
        now = time.time()
        await self._redis.zadd(key, {str(now): now})
        await self._redis.expire(key, self.WINDOW_SECONDS * 2)
