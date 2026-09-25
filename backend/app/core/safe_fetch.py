"""SSRF-hardened image download for user-supplied URLs.

Server-side fetches of URLs a client hands us (e.g. `cover_url`) must never
reach the internal network (minio, redis, postgres, the docker bridge, cloud
metadata...). Every hop — including each redirect — is resolved and rejected
if ANY resolved address is not a public, globally-routable IP. Only image
content types are accepted and the body is size-capped while streaming.
"""

import asyncio
import ipaddress
import socket
from urllib.parse import urljoin, urlsplit

import httpx

ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}
MAX_REDIRECTS = 3


class UnsafeFetchError(Exception):
    pass


async def _assert_public_host(url: str) -> None:
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise UnsafeFetchError(f"scheme/host not allowed: {url!r}")
    port = parts.port or (443 if parts.scheme == "https" else 80)
    try:
        infos = await asyncio.get_running_loop().getaddrinfo(
            parts.hostname, port, type=socket.SOCK_STREAM
        )
    except socket.gaierror as e:
        raise UnsafeFetchError(f"cannot resolve {parts.hostname!r}") from e
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if not ip.is_global or ip.is_multicast:
            raise UnsafeFetchError(f"{parts.hostname!r} resolves to non-public {ip}")


async def fetch_public_image(
    url: str, max_bytes: int = 10 * 1024 * 1024, timeout: float = 15.0
) -> tuple[bytes, str]:
    """Download an image from a public URL. Returns (bytes, content_type)."""
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=False) as client:
        current = url
        for _ in range(MAX_REDIRECTS + 1):
            await _assert_public_host(current)
            async with client.stream("GET", current) as resp:
                if resp.is_redirect:
                    location = resp.headers.get("location")
                    if not location:
                        raise UnsafeFetchError("redirect without location")
                    current = urljoin(current, location)
                    continue
                resp.raise_for_status()
                content_type = resp.headers.get("content-type", "").split(";")[0].strip().lower()
                if content_type not in ALLOWED_IMAGE_TYPES:
                    raise UnsafeFetchError(f"content-type not allowed: {content_type!r}")
                chunks: list[bytes] = []
                total = 0
                async for chunk in resp.aiter_bytes():
                    total += len(chunk)
                    if total > max_bytes:
                        raise UnsafeFetchError("image too large")
                    chunks.append(chunk)
                return b"".join(chunks), content_type
        raise UnsafeFetchError("too many redirects")
