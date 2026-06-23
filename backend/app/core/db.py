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
        _engine = create_async_engine(
            get_settings().database_url,
            pool_pre_ping=True,
            pool_recycle=300,  # Recycle connections every 5min to avoid stale prepared stmts
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


def reset_engine() -> None:
    """Discard the cached engine so the next get_engine() call creates a fresh one.

    Call this after startup scripts (seed, migrations) that create the engine
    on a temporary event loop via asyncio.run().  Without this, uvicorn would
    reuse an engine whose connections are bound to the dead event loop,
    causing ``RuntimeError: Future attached to a different loop``.
    """
    global _engine, _session_factory
    if _engine is not None:
        # Synchronous dispose — fire-and-forget; the pool will close
        # connections lazily anyway.  The important thing is to drop the
        # reference so get_engine() creates a new engine on the current loop.
        _engine = None
        _session_factory = None
