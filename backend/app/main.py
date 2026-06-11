from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

import redis.asyncio as aioredis
from fastapi import FastAPI
from sqlalchemy import text

from app.core.config import get_settings
from app.core.db import get_engine


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    # Fail fast: settings load (and validate) before the app accepts traffic.
    get_settings()
    yield


def create_app() -> FastAPI:
    app = FastAPI(
        title="MeetBook API",
        version="0.1.0",
        lifespan=lifespan,
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
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

    return app


app = create_app()
