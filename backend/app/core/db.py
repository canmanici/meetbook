from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from app.core.config import get_settings


class Base(DeclarativeBase):
    """Single declarative base; every module's models.py inherits from this."""


_engine: AsyncEngine | None = None
_session_factory: async_sessionmaker[AsyncSession] | None = None


def get_engine() -> AsyncEngine:
    global _engine, _session_factory
    if _engine is None:
        settings = get_settings()
        _engine = create_async_engine(
            settings.database_url,
            pool_size=settings.database_pool_size,
            max_overflow=settings.database_max_overflow,
            pool_timeout=settings.database_pool_timeout,
            pool_pre_ping=settings.database_pool_pre_ping,
            pool_recycle=settings.database_pool_recycle,
            # LIFO hands out the most recently used connection: a few hot
            # connections serve steady traffic and burst extras go idle.
            pool_use_lifo=True,
            connect_args={
                "server_settings": {
                    # Postgres JIT compiles plans for "expensive" queries; for
                    # short OLTP queries the compile costs more than it saves.
                    "jit": "off",
                    "application_name": "meetbook-api",
                },
            },
        )
        _session_factory = async_sessionmaker(_engine, expire_on_commit=False)
    return _engine


async def get_session() -> AsyncIterator[AsyncSession]:
    """FastAPI dependency: one session per request, rolled back on error."""
    get_engine()
    assert _session_factory is not None
    async with _session_factory() as session:
        yield session


def get_session_factory() -> async_sessionmaker[AsyncSession]:
    """Session factory for code outside the request cycle (e.g. background workers)."""
    get_engine()
    assert _session_factory is not None
    return _session_factory


async def reset_engine() -> None:
    """Discard the cached engine so the next get_engine() call creates a fresh one.

    Call this after startup scripts (seed, migrations) that create the engine
    on a temporary event loop via asyncio.run().  Without this, uvicorn would
    reuse an engine whose connections are bound to the dead event loop,
    causing ``RuntimeError: Future attached to a different loop``.
    """
    global _engine, _session_factory
    if _engine is not None:
        await _engine.dispose()
        _engine = None
        _session_factory = None
