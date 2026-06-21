#!/usr/bin/env python3
"""Fetch book cover images from Open Library for all books.
Run: cd /app && PYTHONPATH=/app uv run --no-dev python scripts/fetch_book_covers.py
"""
import asyncio
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ["ENV"] = "development"

import httpx
from sqlalchemy import select, text
from app.core.db import get_session_factory
from app.modules.books.models import Book, BookPhoto


COVER_URL_TPL = "https://covers.openlibrary.org/b/id/{cover_id}-M.jpg"
COVER_URL_L_TPL = "https://covers.openlibrary.org/b/id/{cover_id}-L.jpg"
OPENLIB_SEARCH = "https://openlibrary.org/search.json"


async def search_cover(client: httpx.AsyncClient, title: str, author: str, sem: asyncio.Semaphore) -> str | None:
    """Search Open Library for a cover image URL. Returns None if no cover found."""
    query = f'title:"{title}" author:"{author}"'
    async with sem:
        try:
            r = await client.get(
                OPENLIB_SEARCH,
                params={"q": query, "limit": 3},
                timeout=10,
            )
            if r.status_code != 200:
                return None
            data = r.json()
            docs = data.get("docs", [])
            for doc in docs:
                cover_i = doc.get("cover_i")
                if cover_i:
                    return COVER_URL_TPL.format(cover_id=cover_i)
                # Try ISBN-based cover
                isbn_list = doc.get("isbn", [])
                if isbn_list:
                    return f"https://covers.openlibrary.org/b/isbn/{isbn_list[0]}-M.jpg"
            return None
        except Exception:
            return None


async def fetch_all_covers():
    print("=" * 60)
    print("  Fetching book covers from Open Library")
    print("=" * 60)

    factory = get_session_factory()
    async with factory() as session:
        result = await session.execute(
            select(Book).where(Book.deleted_at.is_(None)).order_by(Book.created_at)
        )
        books = result.scalars().all()
        print(f"  ✓ {len(books)} books loaded")

    sem = asyncio.Semaphore(5)  # max 5 concurrent requests
    async with httpx.AsyncClient(timeout=30) as client:
        tasks = []
        for book in books:
            if book.author:
                tasks.append(search_cover(client, book.title, book.author, sem))
            else:
                tasks.append(asyncio.sleep(0, result=None))

        results = await asyncio.gather(*tasks)

    # Insert cover URLs
    async with factory() as session:
        now = datetime.now(timezone.utc)
        inserted = 0
        skipped = 0
        for book, cover_url in zip(books, results):
            if cover_url:
                photo = BookPhoto(
                    book_id=book.id,
                    url=cover_url,
                    thumbnail_url=cover_url.replace("-M.jpg", "-S.jpg"),
                    position=0,
                    created_at=now,
                )
                session.add(photo)
                inserted += 1
            else:
                # Placeholder cover for books without Open Library image
                placeholder_url = f"https://placehold.co/400x600/EEE/999?text={book.title[:30]}"
                photo = BookPhoto(
                    book_id=book.id,
                    url=placeholder_url,
                    thumbnail_url=placeholder_url,
                    position=0,
                    created_at=now,
                )
                session.add(photo)
                skipped += 1

            if (inserted + skipped) % 20 == 0:
                print(f"  Progress: {inserted} real covers, {skipped} placeholders")

        await session.commit()
        print(f"\n  ✅ Done! {inserted} real covers + {skipped} placeholders = {inserted + skipped} books with covers")

    # Summary
    async with factory() as session:
        total_photos = await session.scalar(text("SELECT COUNT(*) FROM book_photos"))
        print(f"  Total book_photos in DB: {total_photos}")
    return 0


def main():
    return asyncio.run(fetch_all_covers())


if __name__ == "__main__":
    sys.exit(main())
