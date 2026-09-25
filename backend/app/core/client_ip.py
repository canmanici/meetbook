"""Resolve the real client IP without trusting client-controlled headers.

The LEFTMOST X-Forwarded-For entry is whatever the client typed — using it
for throttling lets an attacker rotate it per request and bypass login
throttling and rate limits entirely. Our proxy (Traefik) APPENDS the address
it actually saw, so the trustworthy entry is the one `trusted_proxy_hops`
from the RIGHT — and only when the direct peer is itself a private/internal
address (i.e. the request really came through our proxy).
"""

import ipaddress

from app.core.config import get_settings


def _is_internal(host: str) -> bool:
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return False
    return ip.is_private or ip.is_loopback


def resolve_client_ip(peer: str | None, forwarded_for: str | None) -> str:
    if peer and _is_internal(peer) and forwarded_for:
        hops = max(1, get_settings().trusted_proxy_hops)
        parts = [p.strip() for p in forwarded_for.split(",") if p.strip()]
        if len(parts) >= hops:
            return parts[-hops]
    return peer or "unknown"
