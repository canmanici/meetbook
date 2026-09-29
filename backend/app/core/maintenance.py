"""Maintenance mode — used while an admin load test runs.

While active, every request is answered with 503 except:
  - requests carrying the current run's secret ``X-Loadtest-Key`` header
    (the load generator's own traffic),
  - requests whose bearer token belongs to an admin (the panel keeps working),
  - the admin panel's static files, health check, login and token refresh.

State lives in this process only (the app runs one uvicorn worker). It has a
hard deadline: even if the run crashes or the event loop never gets to call
``end()``, maintenance switches itself off when the deadline passes. A process
restart clears it as well.

Pure ASGI (no BaseHTTPMiddleware) — see rate_limit.py for why.
"""

from __future__ import annotations

import hmac
import json
import time
import uuid

from starlette.types import ASGIApp, Receive, Scope, Send

from app.core.security import decode_access_token

LOADTEST_HEADER = b"x-loadtest-key"
# Synthetic load-test accounts live under this RFC 2606 reserved domain
# (never deliverable). Registration refuses it, so no real account can ever
# match the load-test purge.
LOADTEST_EMAIL_DOMAIN = "loadtest.meetbook.example.com"

_MESSAGE = "MeetBook kısa bir bakım çalışmasında. Lütfen birkaç dakika sonra tekrar deneyin."

# Paths always reachable during maintenance (prefix match).
_OPEN_PREFIXES = ("/admin", "/api/v1/health", "/api/v1/auth/login", "/api/v1/auth/refresh")


class _State:
    active: bool = False
    key: str = ""
    deadline: float = 0.0  # time.monotonic()
    admin_ids: frozenset[str] = frozenset()
    reason: str = ""


_state = _State()


def begin(key: str, max_seconds: float, admin_ids: set[uuid.UUID], reason: str) -> None:
    _state.key = key
    _state.deadline = time.monotonic() + max_seconds
    _state.admin_ids = frozenset(str(a) for a in admin_ids)
    _state.reason = reason
    _state.active = True


def end() -> None:
    _state.active = False
    _state.key = ""
    _state.admin_ids = frozenset()
    _state.reason = ""


def is_active() -> bool:
    if _state.active and time.monotonic() >= _state.deadline:
        end()
    return _state.active


def seconds_left() -> int:
    return max(0, int(_state.deadline - time.monotonic())) if is_active() else 0


def is_loadtest_request(scope: Scope) -> bool:
    """True for the running load test's own traffic (valid secret header)."""
    if not _state.key:
        return False
    for name, value in scope.get("headers", []):
        if name == LOADTEST_HEADER:
            return hmac.compare_digest(value, _state.key.encode())
    return False


def _allowed(scope: Scope) -> bool:
    path: str = scope.get("path", "")
    if path.startswith(_OPEN_PREFIXES):
        return True
    auth = b""
    for name, value in scope.get("headers", []):
        if name == LOADTEST_HEADER:
            if _state.key and hmac.compare_digest(value, _state.key.encode()):
                return True
        elif name == b"authorization":
            auth = value
    if auth.startswith(b"Bearer ") and _state.admin_ids:
        try:
            sub = decode_access_token(auth[7:].decode()).get("sub")
        except Exception:
            return False
        return sub in _state.admin_ids
    return False


class MaintenanceMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if not _state.active or scope["type"] not in ("http", "websocket") or _allowed(scope):
            await self.app(scope, receive, send)
            return
        if not is_active():  # deadline just passed
            await self.app(scope, receive, send)
            return

        retry = str(max(1, seconds_left()))
        if scope["type"] == "websocket":
            # Rejecting before accept -> the client sees an HTTP 403 handshake
            # failure and retries with its normal backoff.
            await send({"type": "websocket.close", "code": 1013, "reason": "maintenance"})
            return
        body = json.dumps(
            {"detail": _MESSAGE, "maintenance": True, "retry_after": int(retry)}
        ).encode()
        await send(
            {
                "type": "http.response.start",
                "status": 503,
                "headers": [
                    (b"content-type", b"application/json"),
                    (b"retry-after", retry.encode()),
                    (b"content-length", str(len(body)).encode()),
                ],
            }
        )
        await send({"type": "http.response.body", "body": body})
