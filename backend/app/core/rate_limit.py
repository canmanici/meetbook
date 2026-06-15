"""Global + per-route rate limiting middleware."""

import time
from collections.abc import Awaitable, Callable

import redis.asyncio as aioredis
from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.security import decode_access_token


class RateLimitConfig:
    def __init__(
        self,
        requests_per_minute: int = 120,
        route_limits: dict[str, tuple[int, int]] | None = None,
        trusted_proxies: set[str] | None = None,
    ) -> None:
        self.requests_per_minute = requests_per_minute
        # route_limits: {path_pattern: (limit, window_seconds)}
        self.route_limits = route_limits or {}
        # Proxies whose X-Forwarded-For we trust (empty = trust all for now)
        self.trusted_proxies = trusted_proxies or set()


class RateLimitMiddleware(BaseHTTPMiddleware):
    def __init__(
        self,
        app,
        redis_client: aioredis.Redis,
        config: RateLimitConfig | None = None,
    ) -> None:
        super().__init__(app)
        self._redis = redis_client
        self._config = config or RateLimitConfig()

    @staticmethod
    def _get_client_ip(request: Request) -> str:
        """Extract the real client IP, checking proxy headers first.

        Precedence:
          1. X-Forwarded-For  (leftmost, comma-separated)
          2. X-Real-IP        (single IP, used by nginx)
          3. request.client.host (direct connection / fallback)
        """
        forwarded = request.headers.get("X-Forwarded-For", "")
        if forwarded:
            # Leftmost IP is the original client
            client_ip = forwarded.split(",")[0].strip()
            if client_ip:
                return client_ip

        real_ip = request.headers.get("X-Real-IP", "")
        if real_ip:
            return real_ip.strip()

        return request.client.host if request.client else "unknown"

    @staticmethod
    def _match_route(path: str, pattern: str) -> bool:
        """Exact match or prefix-with-slash to avoid 'password-reset' catching 'password-reset-request'."""
        return path == pattern or path.startswith(pattern + "/")

    async def dispatch(
        self, request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        # Identify user
        user_id = None
        auth_header = request.headers.get("authorization", "")
        if auth_header.startswith("Bearer "):
            try:
                payload = decode_access_token(auth_header[7:])
                user_id = payload.get("sub")
            except Exception:  # noqa: S110
                pass

        # Use user_id for authenticated users (per-user buckets),
        # real client IP for unauthenticated (anti-abuse).
        if user_id:
            identifier = user_id
        else:
            identifier = self._get_client_ip(request)

        key_prefix = f"ratelimit:{identifier}"

        # Check route-specific limits
        path = request.url.path
        for pattern, (limit, window) in self._config.route_limits.items():
            if self._match_route(path, pattern):
                key = f"{key_prefix}:{pattern}"
                allowed, retry_after = await self._check_limit(key, limit, window)
                if not allowed:
                    response = Response(
                        content='{"detail":"Rate limit exceeded"}',
                        status_code=429,
                        media_type="application/json",
                    )
                    response.headers["Retry-After"] = str(retry_after)
                    return response
                break

        # Check global limit
        key = f"{key_prefix}:global"
        allowed, retry_after = await self._check_limit(
            key, self._config.requests_per_minute, 60
        )
        if not allowed:
            response = Response(
                content='{"detail":"Rate limit exceeded"}',
                status_code=429,
                media_type="application/json",
            )
            response.headers["Retry-After"] = str(retry_after)
            return response

        response = await call_next(request)

        # Add rate limit headers
        remaining = await self._redis.zcard(key)
        response.headers["X-RateLimit-Limit"] = str(self._config.requests_per_minute)
        response.headers["X-RateLimit-Remaining"] = str(
            max(0, self._config.requests_per_minute - remaining)
        )

        return response

    async def _check_limit(
        self, key: str, limit: int, window_seconds: int
    ) -> tuple[bool, int]:
        now = time.time()
        window_start = now - window_seconds

        pipe = self._redis.pipeline()
        pipe.zremrangebyscore(key, 0, window_start)
        pipe.zadd(key, {str(now): now})
        pipe.zcard(key)
        pipe.expire(key, window_seconds)
        results = await pipe.execute()

        count = results[2]
        if count > limit:
            # Remove the entry we just added
            await self._redis.zrem(key, str(now))
            oldest = await self._redis.zrangebyscore(key, window_start, now, start=0, num=1)
            if oldest:
                retry_after = int(float(oldest[0]) + window_seconds - now)
                return False, max(retry_after, 1)
            return False, window_seconds

        return True, 0
