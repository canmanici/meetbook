"""Shared outbound httpx client (Expo push, Google Places, Open Library).

A new ``httpx.AsyncClient`` per call pays TLS setup + a fresh connection
pool every time and leaves the SSL context/pool for the GC. One client per
event loop keeps connections warm. Closed on app shutdown (lifespan).
Per-call ``timeout=`` / ``follow_redirects=`` still work as request kwargs.

Not for user-controlled URLs — those go through ``app.core.safe_fetch``.
"""

import asyncio

import httpx

_client: httpx.AsyncClient | None = None
_client_loop: asyncio.AbstractEventLoop | None = None


def get_http_client() -> httpx.AsyncClient:
    global _client, _client_loop
    loop = asyncio.get_running_loop()
    if _client is None or _client_loop is not loop or _client.is_closed:
        # A new loop (tests use one per test) cannot reuse loop-bound sockets.
        _client = httpx.AsyncClient(
            timeout=10.0,
            limits=httpx.Limits(max_connections=50, max_keepalive_connections=10),
        )
        _client_loop = loop
    return _client


async def close_http_client() -> None:
    global _client, _client_loop
    client, loop = _client, _client_loop
    _client = _client_loop = None
    if client is not None and loop is asyncio.get_running_loop():
        await client.aclose()
