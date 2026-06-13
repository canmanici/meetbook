import logging
import time
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import redis.asyncio as aioredis
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

from app.core.config import get_settings
from app.core.db import get_engine, get_session_factory
from app.core.rate_limit import RateLimitConfig, RateLimitMiddleware

logger = logging.getLogger("app.access")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    # Fail fast: settings load (and validate) before the app accepts traffic.
    settings = get_settings()

    # Create MinIO bucket on startup if S3 is configured
    if settings.s3_bucket and settings.s3_access_key:
        try:
            import aioboto3
            from botocore.config import Config

            session = aioboto3.Session()
            async with session.client(
                "s3",
                endpoint_url=settings.s3_endpoint or None,
                aws_access_key_id=settings.s3_access_key,
                aws_secret_access_key=settings.s3_secret_key,
                config=Config(signature_version="s3v4"),
            ) as client:
                exists = await client.head_bucket(Bucket=settings.s3_bucket)
        except Exception:
            try:
                async with session.client(
                    "s3",
                    endpoint_url=settings.s3_endpoint or None,
                    aws_access_key_id=settings.s3_access_key,
                    aws_secret_access_key=settings.s3_secret_key,
                    config=Config(signature_version="s3v4"),
                ) as client:
                    await client.create_bucket(Bucket=settings.s3_bucket)
            except Exception:
                pass  # Bucket may already exist or MinIO not ready yet

    # Hourly worker: expire overdue exchange requests. Skipped in tests, where
    # create_app() runs once per test and a real scheduler would never stop.
    scheduler = None
    if settings.env != "test":
        from apscheduler.schedulers.asyncio import AsyncIOScheduler

        from app.workers.expire_requests import expire_requests

        async def _run_expire_requests() -> None:
            async with get_session_factory()() as session:
                await expire_requests(session)

        scheduler = AsyncIOScheduler()
        scheduler.add_job(_run_expire_requests, "interval", hours=1)
        scheduler.start()

    yield

    if scheduler is not None:
        scheduler.shutdown()


def create_app() -> FastAPI:
    app = FastAPI(
        title="MeetBook API",
        version="0.1.0",
        lifespan=lifespan,
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=get_settings().cors_origins_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/api/v1/health")
    async def health() -> dict[str, Any]:
        """Liveness + dependency check: DB (with PostGIS) and Redis must answer."""
        async with get_engine().connect() as conn:
            postgis = (await conn.execute(text("SELECT PostGIS_Version()"))).scalar()
        r = aioredis.from_url(get_settings().redis_url)
        try:
            await r.ping()
        finally:
            await r.aclose()
        return {"status": "ok", "postgis": postgis}

    # Auth module
    from app.modules.auth.router import router as auth_router
    app.include_router(auth_router, prefix="/api/v1")

    # Books module
    from app.modules.books.router import router as books_router
    app.include_router(books_router, prefix="/api/v1")

    # Wishlist module
    from app.modules.wishlist.router import router as wishlist_router
    app.include_router(wishlist_router, prefix="/api/v1")

    # Exchanges module
    from app.modules.exchanges.router import router as exchanges_router
    app.include_router(exchanges_router, prefix="/api/v1")

    # Places proxy module
    from app.modules.places.router import router as places_router
    app.include_router(places_router, prefix="/api/v1")

    # Rate limiting
    redis_client = aioredis.from_url(get_settings().redis_url)
    rate_config = RateLimitConfig(
        requests_per_minute=120,
        route_limits={
            "/auth/register": (5, 3600),  # 5/hour
            "/auth/login": (10, 60),  # 10/min
            "/auth/refresh": (20, 60),  # 20/min
            "/auth/password-reset": (5, 3600),  # 5/hour
            "/places": (60, 60),  # 60/min
        },
    )
    app.add_middleware(RateLimitMiddleware, redis_client=redis_client, config=rate_config)

    # Serve uploaded photos (local dev only — S3 URLs bypass this)
    media_dir = Path(get_settings().media_dir)
    media_dir.mkdir(parents=True, exist_ok=True)
    app.mount("/media", StaticFiles(directory=str(media_dir)), name="media")

    return app


app = create_app()
