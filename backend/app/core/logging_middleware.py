"""Structured JSON logging with per-request context."""

import logging
import time
import uuid

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.types import ASGIApp


class _SafeStructuredFormatter(logging.Formatter):
    """JSON formatter that handles log calls from non-request code (apscheduler, etc.).

    Without this, any logger call from outside the request cycle (e.g. APScheduler
    startup/shutdown logs) would crash with ``KeyError: 'request_id'`` because those
    fields only exist in the middleware's LogAdapter.

    The formatter returns ``"-"`` / ``0`` defaults when a field is missing instead of
    raising ``KeyError``.
    """

    _FALLBACKS = {
        "request_id": "-",
        "method": "-",
        "path": "-",
        "status_code": 0,
        "duration_ms": 0,
    }

    def format(self, record: logging.LogRecord) -> str:
        for key, default in self._FALLBACKS.items():
            if not hasattr(record, key):
                setattr(record, key, default)
        return super().format(record)


class StructuredLoggingMiddleware(BaseHTTPMiddleware):
    """Adds request_id, duration_ms, method, path, status_code to every log entry.

    Uses logging.LogAdapter to inject context into all log calls during the request.
    """

    def __init__(self, app: ASGIApp) -> None:
        super().__init__(app)
        # Configure root logger for JSON output (production) or human-readable (dev)
        self._configure_root_logger()

    def _configure_root_logger(self) -> None:
        """Ensure root logger has a handler that outputs structured logs."""
        root = logging.getLogger()
        if root.handlers:
            return  # Already configured (e.g., by uvicorn)

        handler = logging.StreamHandler()
        formatter = _SafeStructuredFormatter(
            '{"time": "%(asctime)s", "level": "%(levelname)s", '
            '"logger": "%(name)s", "message": "%(message)s", '
            '"request_id": "%(request_id)s", '
            '"method": "%(method)s", "path": "%(path)s", '
            '"status": %(status_code)s, "duration_ms": %(duration_ms)s}',
            datefmt="%Y-%m-%dT%H:%M:%S",
        )
        handler.setFormatter(formatter)
        root.addHandler(handler)
        root.setLevel(logging.INFO)

    async def dispatch(self, request: Request, call_next):
        request_id = str(uuid.uuid4())[:8]
        start = time.monotonic()

        # Inject context into all log adapters during this request
        extra = {
            "request_id": request_id,
            "method": request.method,
            "path": request.url.path,
            "status_code": 0,
            "duration_ms": 0,
        }

        # Attach to request state for downstream loggers
        request.state.request_id = request_id

        response = await call_next(request)

        duration_ms = round((time.monotonic() - start) * 1000)
        extra["status_code"] = response.status_code
        extra["duration_ms"] = duration_ms

        logger = logging.getLogger("app.access")
        logger.info(
            "%s %s → %s (%sms)",
            request.method,
            request.url.path,
            response.status_code,
            duration_ms,
            extra=extra,
        )

        response.headers["X-Request-ID"] = request_id
        return response
