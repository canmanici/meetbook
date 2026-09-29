"""Global + per-route rate limiting middleware.

Pure ASGI implementation — avoids starlette.BaseHTTPMiddleware which is
incompatible with asyncpg's event-loop-bound connections.
"""

import json
import time
from typing import Any

import redis.asyncio as aioredis
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.client_ip import resolve_client_ip
from app.core.maintenance import is_loadtest_request
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


class RateLimitMiddleware:
    """Pure ASGI rate-limit middleware.

    Using BaseHTTPMiddleware causes ``RuntimeError: Future attached to a
    different loop`` with asyncpg because it wraps the endpoint in a new
    task.  This implementation is a plain ASGI middleware that operates on
    the raw scope/headers without creating new tasks.
    """

    def __init__(
        self,
        app: ASGIApp,
        redis_client: aioredis.Redis,
        config: RateLimitConfig | None = None,
    ) -> None:
        self.app = app
        self._redis = redis_client
        self._config = config or RateLimitConfig()

    # ------------------------------------------------------------------
    # ASGI interface
    # ------------------------------------------------------------------

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        # Load-test traffic is one IP hammering on purpose — never throttle it.
        if scope["type"] != "http" or is_loadtest_request(scope):
            await self.app(scope, receive, send)
            return

        headers = dict(scope.get("headers", []))
        # headers values are bytes; normalise to str
        headers = {k.decode(): v.decode() for k, v in scope.get("headers", [])}

        # Identify user
        identifier = self._extract_identifier(scope, headers)

        key_prefix = f"ratelimit:{identifier}"
        path = scope.get("path", "")

        # Check route-specific limits
        blocked_response: dict[str, Any] | None = None
        route_key: str | None = None
        for pattern, (limit, window) in self._config.route_limits.items():
            if path == pattern or path.startswith(pattern + "/"):
                route_key = f"{key_prefix}:{pattern}"
                allowed, retry_after = await self._check_limit(route_key, limit, window)
                if not allowed:
                    blocked_response = {
                        "detail": "Rate limit exceeded",
                        "retry_after": retry_after,
                    }
                break

        # Check global limit (only if route check passed)
        global_key = f"{key_prefix}:global"
        if blocked_response is None:
            allowed, retry_after = await self._check_limit(
                global_key, self._config.requests_per_minute, 60
            )
            if not allowed:
                blocked_response = {
                    "detail": "Rate limit exceeded",
                    "retry_after": retry_after,
                }

        if blocked_response is not None:
            body = json.dumps(blocked_response).encode()
            response_headers = [
                [b"content-type", b"application/json"],
                [b"retry-after", str(blocked_response["retry_after"]).encode()],
            ]
            await send(
                {
                    "type": "http.response.start",
                    "status": 429,
                    "headers": response_headers,
                }
            )
            await send(
                {
                    "type": "http.response.body",
                    "body": body,
                }
            )
            return

        # Forward to downstream app, intercepting response headers
        response_started = False

        async def send_wrapper(message: Message) -> None:
            nonlocal response_started
            if message["type"] == "http.response.start":
                response_started = True
                # Add rate-limit headers
                remaining = await self._redis.zcard(global_key)
                original_headers = list(message.get("headers", []))
                original_headers.append(
                    [b"x-ratelimit-limit", str(self._config.requests_per_minute).encode()]
                )
                original_headers.append(
                    [
                        b"x-ratelimit-remaining",
                        str(max(0, self._config.requests_per_minute - remaining)).encode(),
                    ]
                )
                message["headers"] = original_headers
            await send(message)

        await self.app(scope, receive, send_wrapper)

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _extract_identifier(self, scope: Scope, headers: dict[str, str]) -> str:
        """Use user_id for authenticated users (per-user buckets),
        real client IP for unauthenticated (anti-abuse)."""
        auth_header = headers.get("authorization", "")
        if auth_header.startswith("Bearer "):
            try:
                payload = decode_access_token(auth_header[7:])
                sub = payload.get("sub")
                if sub:
                    return sub
            except Exception:  # noqa: S110
                pass

        return self._get_client_ip(scope, headers)

    @staticmethod
    def _get_client_ip(scope: Scope, headers: dict[str, str]) -> str:
        client = scope.get("client")
        peer = client[0] if client else None
        return resolve_client_ip(peer, headers.get("x-forwarded-for"))

    async def _check_limit(self, key: str, limit: int, window_seconds: int) -> tuple[bool, int]:
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
                first = oldest[0]
                first_ts = float(first.decode() if isinstance(first, bytes) else str(first))
                retry_after = int(first_ts + window_seconds - now)
                return False, max(retry_after, 1)
            return False, window_seconds

        return True, 0
