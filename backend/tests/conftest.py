"""Shared test fixtures."""

import os
from collections.abc import AsyncIterator
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest_asyncio
import redis.asyncio as aioredis
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

os.environ["ENV"] = "test"

from app.core.config import get_settings  # noqa: E402
from app.core.db import Base, get_session  # noqa: E402
from app.main import create_app  # noqa: E402


@pytest_asyncio.fixture
async def db_engine() -> AsyncIterator[Any]:
    settings = get_settings()
    engine = create_async_engine(settings.database_url, pool_pre_ping=True)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield engine
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()


@pytest_asyncio.fixture
async def db_session(db_engine: Any) -> AsyncIterator[AsyncSession]:
    session_factory = async_sessionmaker(db_engine, expire_on_commit=False)
    async with session_factory() as session:
        yield session
        await session.rollback()


@pytest_asyncio.fixture(autouse=True)
async def _flush_rate_limits() -> AsyncIterator[None]:
    """Reset the rate-limit counters in Redis so tests don't interfere with each other."""
    r = aioredis.from_url(get_settings().redis_url)
    await r.flushdb()
    try:
        yield
    finally:
        await r.aclose()


@pytest_asyncio.fixture
async def client(db_engine: Any) -> AsyncIterator[httpx.AsyncClient]:
    session_factory = async_sessionmaker(db_engine, expire_on_commit=False)

    async def override_get_session() -> AsyncIterator[AsyncSession]:
        async with session_factory() as session:
            yield session
            await session.rollback()

    app = create_app()
    app.dependency_overrides[get_session] = override_get_session

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


@pytest_asyncio.fixture
async def redis_mock() -> AsyncIterator[MagicMock]:
    mock = AsyncMock()
    mock.ping = AsyncMock(return_value=True)
    mock.get = AsyncMock(return_value=None)
    mock.set = AsyncMock(return_value=True)
    mock.incr = AsyncMock(return_value=1)
    mock.expire = AsyncMock(return_value=True)
    mock.ttl = AsyncMock(return_value=-1)
    mock.delete = AsyncMock(return_value=1)
    mock.zadd = AsyncMock(return_value=1)
    mock.zremrangebyscore = AsyncMock(return_value=0)
    mock.zcard = AsyncMock(return_value=0)
    mock.multi = AsyncMock()
    mock.execute = AsyncMock(return_value=[1, True])
    yield mock
