"""MeetBook API application factory."""

import logging
import os
from pathlib import Path
from typing import Any

import redis.asyncio as aioredis
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.core.config import get_settings
from app.core.client_context import ClientContextMiddleware
from app.core.maintenance import MaintenanceMiddleware
from app.core.rate_limit import RateLimitConfig, RateLimitMiddleware
from app.core.redis import get_redis
from app.lifespan import lifespan
from app.routers import register_routers
from app.storage_proxy import router as storage_router

logger = logging.getLogger("app.access")


# The admin panel holds an admin token, so it gets the strictest headers the
# page allows. It is one self-contained file with inline <script>/<style> and
# inline handlers, hence 'unsafe-inline' — but nothing may load from or talk
# to another origin, so even injected markup can't phone a token home.
ADMIN_SECURITY_HEADERS = {
    "Content-Security-Policy": (
        "default-src 'self'; "
        "script-src 'self' 'unsafe-inline'; "
        "style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data: blob:; "
        "font-src 'self' data:; "
        "connect-src 'self'; "
        "object-src 'none'; "
        "base-uri 'none'; "
        "form-action 'self'; "
        "frame-ancestors 'none'"
    ),
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
}


class _RevalidatingStaticFiles(StaticFiles):
    """Admin panel is a single HTML file that changes with every deploy —
    make browsers revalidate (ETag → 304) instead of serving a stale copy."""

    async def get_response(self, path: str, scope: Any) -> Any:
        response = await super().get_response(path, scope)
        response.headers["Cache-Control"] = "no-cache"
        response.headers.update(ADMIN_SECURITY_HEADERS)
        return response


def create_app() -> FastAPI:
    settings = get_settings()
    is_dev = settings.is_dev
    if not is_dev and not settings.email_verification_required:
        logger.warning(
            "EMAIL_VERIFICATION_REQUIRED=false: sign-ups are not e-mail verified (demo mode)"
        )
    elif not is_dev and not settings.mail_enabled:
        # Sign-ups can't receive their code, so nobody new can verify.
        logger.error("SMTP_HOST is not set: new accounts cannot verify their email")

    app = FastAPI(
        title="MeetBook API",
        version="0.1.0",
        lifespan=lifespan,
        docs_url="/api/docs" if is_dev else None,
        redoc_url="/redoc" if is_dev else None,
        openapi_url="/api/openapi.json" if is_dev else None,
    )

    # CORS
    app.add_middleware(
        CORSMiddleware,
        allow_origins=get_settings().cors_origins_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Crash reports are submitted via POST /api/v1/crash-report (no auth needed)
    # and viewed via admin panel at /api/v1/admin/crash-reports

    # Health check
    from fastapi.responses import JSONResponse
    from sqlalchemy import text

    from app.core.db import get_engine

    @app.get("/api/v1/health")
    async def health() -> JSONResponse:
        errors: list[str] = []
        postgis_version = None
        try:
            async with get_engine().connect() as conn:
                postgis_version = (await conn.execute(text("SELECT PostGIS_Version()"))).scalar()
        except Exception as exc:
            errors.append(f"PostGIS: {exc}")
        try:
            r = get_redis()
            await r.ping()
        except Exception as exc:
            errors.append(f"Redis: {exc}")
        if errors:
            return JSONResponse(status_code=503, content={"status": "unhealthy", "errors": errors})
        return JSONResponse(content={"status": "ok", "postgis": postgis_version})

    # Module routers
    register_routers(app)

    # Storage proxy (fallback MinIO access)
    app.include_router(storage_router)

    # Rate limiting — off unless RATE_LIMIT_ENABLED=true (see config.py).
    # When on, the global ceiling and the per-route table are overridable
    # from the environment so a load test can raise them without code:
    #   RATE_LIMIT_GLOBAL=0 disables limiting entirely.
    #   RATE_LIMIT_SCALE=10 multiplies every limit (useful for load tests).
    settings = get_settings()

    def _env_int(name: str, default: int) -> int:
        """Read an int from the environment, tolerating unset/blank/garbage.

        Compose interpolation yields an EMPTY STRING for an unset variable
        (e.g. RATE_LIMIT_GLOBAL: "${RATE_LIMIT_GLOBAL:-}"), and a bare
        int("") raises ValueError — which used to abort startup. Unset and
        malformed both fall back to the default instead.
        """
        raw = os.environ.get(name, "").strip()
        if not raw:
            return default
        try:
            return int(raw)
        except ValueError:
            logger.warning("%s=%r is not an int — using %s", name, raw, default)
            return default

    _global_limit = _env_int("RATE_LIMIT_GLOBAL", 300)
    _scale = max(0, _env_int("RATE_LIMIT_SCALE", 1))
    _route_limits = {
        "/api/v1/auth/register": (30, 3600),
        "/api/v1/auth/login": (30, 60),
        "/api/v1/auth/refresh": (60, 60),
        "/api/v1/auth/google": (30, 60),
        "/api/v1/auth/password-reset-request": (20, 3600),
        "/api/v1/auth/password-reset-confirm": (20, 3600),
        "/api/v1/auth/verify-email": (30, 3600),
        "/legal/veri-sahibi-basvuru": (10, 3600),
        "/api/v1/privacy/deletion-request": (20, 3600),
        "/api/v1/places": (120, 60),
        "/api/v1/reports": (60, 3600),
        "/api/v1/admin": (120, 60),
        # Public, unauthenticated ingest — cap per client IP.
        "/api/v1/crash-report": (30, 60),
    }
    if settings.rate_limit_enabled and _global_limit > 0 and _scale > 0:
        # A connection pool large enough that the limiter never becomes the
        # bottleneck: the default 100 was observed exhausting under load
        # (redis.exceptions.MaxConnectionsError -> HTTP 500).
        redis_client = aioredis.from_url(
            settings.redis_url,
            max_connections=_env_int("RATE_LIMIT_REDIS_POOL", 256),
        )
        rate_config = RateLimitConfig(
            requests_per_minute=_global_limit * _scale,
            route_limits={k: (v[0] * _scale, v[1]) for k, v in _route_limits.items()},
        )
        app.add_middleware(RateLimitMiddleware, redis_client=redis_client, config=rate_config)
    else:
        logger.warning("Rate limiting DISABLED")
    # Record who the client is (real IP, device, ISP) for this request.
    app.add_middleware(ClientContextMiddleware)
    # Outermost: during an admin load test, turn everyone else away before
    # any other work is done for them (see app/core/maintenance.py).
    app.add_middleware(MaintenanceMiddleware)

    # Admin panel (admin/index.html) — host'ta project-root/admin, container'da /app/admin
    admin_dir = None
    _me = Path(__file__).resolve()
    for _parent in (_me.parent.parent.parent, _me.parent.parent):
        candidate = _parent / "admin"
        # An empty dir (image built without the admin context, or a stale
        # bind mount) must not be mounted — that silently 404s the panel.
        if (candidate / "index.html").is_file():
            admin_dir = candidate
            break
    if admin_dir:
        app.mount(
            "/admin", _RevalidatingStaticFiles(directory=str(admin_dir), html=True), name="admin"
        )
        logger.info("Admin panel mounted at /admin from %s", admin_dir)
    else:
        logger.warning("Admin panel not found (tried parent paths of %s)", _me)

    # Static media (local dev only)
    media_dir = Path(get_settings().media_dir)
    media_dir.mkdir(parents=True, exist_ok=True)
    app.mount("/media", StaticFiles(directory=str(media_dir)), name="media")

    return app


app = create_app()
