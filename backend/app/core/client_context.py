"""Who is on the other end of the request: real IP, device and network.

A pure-ASGI middleware captures the client for every HTTP request into a
ContextVar, so audit events, sessions (refresh tokens) and crash reports can
record it without threading `request` through every service call.

- IP: the trustworthy hop from X-Forwarded-For (see client_ip.py) — never the
  Traefik/docker address.
- Device: the mobile app sends X-Client-* headers (platform, OS version, model,
  app version); for other clients we fall back to a coarse User-Agent parse.
- Network: country / city / ISP (ASN) from the offline DB-IP database
  (app/core/ipdb.py) — IPs are never sent to a third-party lookup service.
"""

from __future__ import annotations

import base64
import binascii
import json
import re
from contextvars import ContextVar
from dataclasses import dataclass
from functools import cached_property
from typing import Any

from starlette.types import ASGIApp, Receive, Scope, Send

from app.core.client_ip import resolve_client_ip
from app.core.ipdb import lookup_ip

_MAX_HEADER = 120
_MAX_INFO_B64 = 4096

# Verbose device profile the app sends in X-Client-Info (see
# mobile/src/lib/client-info.ts). Whitelisted + length-capped: it is
# client-controlled, so it's descriptive data only — never trusted for auth.
_INFO_STR_KEYS = {
    "platform",
    "brand",
    "manufacturer",
    "model_name",
    "model_id",
    "product_name",
    "design_name",
    "device_type",
    "device_name",
    "os_name",
    "os_version",
    "os_build_id",
    "os_internal_build_id",
    "os_build_fingerprint",
    "app_id",
    "app_version",
    "app_build",
    "install_source",
    "device_id",
    "screen",
    "locale",
    "timezone",
}
_INFO_NUM_KEYS = {"device_year_class", "total_memory_mb", "api_level"}
_INFO_BOOL_KEYS = {"is_physical_device"}


def _parse_client_info(raw: str | None) -> dict[str, Any] | None:
    if not raw or len(raw) > _MAX_INFO_B64:
        return None
    try:
        padded = raw + "=" * (-len(raw) % 4)
        data = json.loads(base64.urlsafe_b64decode(padded).decode("utf-8"))
    except ValueError, binascii.Error, UnicodeDecodeError:
        return None
    if not isinstance(data, dict):
        return None
    out: dict[str, Any] = {}
    for k, v in data.items():
        if k in _INFO_STR_KEYS and isinstance(v, str) and v.strip():
            out[k] = v.strip()[:160]
        elif k in _INFO_NUM_KEYS and isinstance(v, (int, float)) and not isinstance(v, bool):
            out[k] = v
        elif k in _INFO_BOOL_KEYS and isinstance(v, bool):
            out[k] = v
        elif k == "cpu_archs" and isinstance(v, list):
            out[k] = [str(x)[:20] for x in v[:6]]
    return out or None


@dataclass(frozen=True)
class ClientContext:
    ip: str | None
    user_agent: str | None
    platform: str | None = None  # android | ios | web
    os_version: str | None = None
    device_model: str | None = None
    app_version: str | None = None
    # Raw X-Client-Info header; decoded only when a row actually records the
    # device (sessions, audit events, crashes) — not on every request.
    info_raw: str | None = None

    @cached_property
    def info(self) -> dict[str, Any] | None:
        """Verbose X-Client-Info profile."""
        return _parse_client_info(self.info_raw)

    def device(self) -> dict[str, Any]:
        """Device profile stored alongside sessions / audit events / crashes."""
        info = self.info or {}
        platform = self.platform or info.get("platform") or _platform_from_ua(self.user_agent)
        model_name = info.get("model_name")
        model_code = info.get("model_id") or info.get("product_name") or self.device_model
        summary = {
            "platform": platform,
            "os": {"android": "Android", "ios": "iOS"}.get(platform or "", platform),
            "os_version": self.os_version
            or info.get("os_version")
            or _os_version_from_ua(self.user_agent),
            # "device_model" keeps the key the admin metrics already group by.
            "device_model": " ".join(x for x in (info.get("brand"), model_name) if x)
            or self.device_model,
            "model_code": model_code,
            "app_version": self.app_version or info.get("app_version"),
        }
        out = {**info, **{k: v for k, v in summary.items() if v}}
        return {k: v for k, v in out.items() if v not in (None, "", [])}

    def network(self) -> dict[str, Any] | None:
        return lookup_ip(self.ip) if self.ip else None

    def snapshot(self) -> dict[str, Any]:
        """Everything worth keeping about the client, JSON-serializable."""
        data: dict[str, Any] = {"device": self.device()}
        net = self.network()
        if net:
            data["network"] = net
        return data


_current: ContextVar[ClientContext | None] = ContextVar("client_context", default=None)


def current_client() -> ClientContext | None:
    return _current.get()


def _clean(v: str | None) -> str | None:
    if not v:
        return None
    v = v.strip()[:_MAX_HEADER]
    return v or None


def _platform_from_ua(ua: str | None) -> str | None:
    if not ua:
        return None
    u = ua.lower()
    if "android" in u or "okhttp" in u:
        return "android"
    if "iphone" in u or "ipad" in u or "cfnetwork" in u or "darwin" in u:
        return "ios"
    if "mozilla" in u:
        return "web"
    return None


_ANDROID_VER = re.compile(r"android[ /]([\d.]+)", re.I)
_IOS_VER = re.compile(r"(?:iphone os|cpu os) ([\d_]+)", re.I)


def _os_version_from_ua(ua: str | None) -> str | None:
    if not ua:
        return None
    m = _ANDROID_VER.search(ua)
    if m:
        return m.group(1)
    m = _IOS_VER.search(ua)
    return m.group(1).replace("_", ".") if m else None


def context_from_scope(scope: Scope) -> ClientContext:
    headers = {
        k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope.get("headers", [])
    }
    client = scope.get("client")
    peer = client[0] if client else None
    platform = _clean(headers.get("x-client-platform"))
    return ClientContext(
        ip=resolve_client_ip(peer, headers.get("x-forwarded-for")),
        user_agent=_clean(headers.get("user-agent")),
        platform=platform.lower() if platform else None,
        os_version=_clean(headers.get("x-client-os-version")),
        device_model=_clean(headers.get("x-client-device-model")),
        app_version=_clean(headers.get("x-client-app-version")),
        info_raw=headers.get("x-client-info"),
    )


class ClientContextMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] not in ("http", "websocket"):
            await self.app(scope, receive, send)
            return
        token = _current.set(context_from_scope(scope))
        try:
            await self.app(scope, receive, send)
        finally:
            _current.reset(token)
