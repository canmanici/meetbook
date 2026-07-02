"""MeetBook API application factory."""

import logging

import redis.asyncio as aioredis
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pathlib import Path

from app.core.config import get_settings
from app.core.rate_limit import RateLimitConfig, RateLimitMiddleware
from app.core.redis import get_redis
from app.lifespan import lifespan
from app.routers import register_routers
from app.storage_proxy import router as storage_router

logger = logging.getLogger("app.access")


def create_app() -> FastAPI:
    settings = get_settings()
    is_dev = settings.env in ("local", "dev", "development", "test")

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
    from sqlalchemy import text
    from app.core.db import get_engine
    from typing import Any
    from fastapi.responses import JSONResponse

    @app.get("/api/v1/health")
    async def health() -> dict[str, Any]:
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
        return {"status": "ok", "postgis": postgis_version}

    # Module routers
    register_routers(app)

    # Storage proxy (fallback MinIO access)
    app.include_router(storage_router)

    # Rate limiting
    redis_client = aioredis.from_url(get_settings().redis_url)
    rate_config = RateLimitConfig(
        requests_per_minute=300,
        route_limits={
            "/api/v1/auth/register": (30, 3600),
            "/api/v1/auth/login": (30, 60),
            "/api/v1/auth/refresh": (60, 60),
            "/api/v1/auth/password-reset-request": (20, 3600),
            "/api/v1/auth/password-reset-confirm": (20, 3600),
            "/api/v1/places": (120, 60),
            "/api/v1/reports": (60, 3600),
            "/api/v1/admin": (120, 60),
        },
    )
    app.add_middleware(RateLimitMiddleware, redis_client=redis_client, config=rate_config)

    # Admin panel (admin/index.html) — host'ta project-root/admin, container'da /app/admin
    admin_dir = None
    _me = Path(__file__).resolve()
    for _parent in (_me.parent.parent.parent, _me.parent.parent):
        candidate = _parent / "admin"
        if candidate.is_dir():
            admin_dir = candidate
            break
    if admin_dir:
        app.mount("/admin", StaticFiles(directory=str(admin_dir), html=True), name="admin")
        logger.info("Admin panel mounted at /admin from %s", admin_dir)
    else:
        logger.warning("Admin panel not found (tried parent paths of %s)", _me)

    # Static media (local dev only)
    media_dir = Path(get_settings().media_dir)
    media_dir.mkdir(parents=True, exist_ok=True)
    app.mount("/media", StaticFiles(directory=str(media_dir)), name="media")

    return app


app = create_app()
