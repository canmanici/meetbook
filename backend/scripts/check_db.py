"""Verify core tables exist after alembic upgrade. Runs inside Docker on startup."""
import asyncio
import sys

from sqlalchemy import text

from app.core.db import get_engine


async def main() -> int:
    async with get_engine().connect() as conn:
        result = await conn.execute(
            text(
                "SELECT EXISTS ("
                "  SELECT FROM information_schema.tables "
                "  WHERE table_schema = 'public' AND table_name = 'users'"
                ")"
            )
        )
        return 0 if result.scalar() else 1


sys.exit(asyncio.run(main()))
