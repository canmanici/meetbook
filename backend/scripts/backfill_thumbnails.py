"""Backfill thumbnails for existing book_photos that don't have one.

Since Pillow is no longer a dependency, this script now just reports
which photos need thumbnails. The actual thumbnail generation should
be done client-side via the PATCH /{book_id}/photos/{photo_id}/thumbnail endpoint.

Usage:
    cd backend && python -m scripts.backfill_thumbnails
"""

import asyncio
import sys
from pathlib import Path

# Add backend root to path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.db import get_engine, get_session_factory
from app.modules.books.models import BookPhoto


async def backfill():
    engine = get_engine()
    session_factory = get_session_factory()

    async with session_factory() as session:
        from sqlalchemy import select

        stmt = select(BookPhoto).where(BookPhoto.thumbnail_url.is_(None))
        result = await session.execute(stmt)
        photos = list(result.scalars().all())

    if not photos:
        print("✅ All photos already have thumbnails. Nothing to do.")
        return

    print(f"📸 Found {len(photos)} photos without thumbnails.")
    print()
    print("These photos need thumbnails. Use the mobile app to backfill:")
    print("  - PATCH /books/{book_id}/photos/{photo_id}/thumbnail")
    print()
    for p in photos:
        print(f"  - photo_id={p.id}  book_id={p.book_id}  url={p.url[:60]}...")
    print()
    print("Or re-upload the photos from the app — thumbnails will be generated automatically.")


if __name__ == "__main__":
    asyncio.run(backfill())
