#!/usr/bin/env python3
"""Backfill book covers: download from Open Library → upload to MinIO → insert DB records.

For books without Open Library covers, downloads a placeholder from placehold.co
and uploads it to MinIO.

Usage (inside backend container):
    cd /app && PYTHONPATH=/app uv run --no-dev python scripts/backfill_book_covers.py
"""

import asyncio
import os
import sys
import uuid
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ["ENV"] = "development"

import httpx
from sqlalchemy import select, text

from app.core.db import get_session_factory
from app.modules.books.models import Book, BookPhoto

# ── Config ──────────────────────────────────────────────────────────────────────

S3_ENDPOINT = "http://minio:9000"
S3_EXTERNAL = "http://192.168.8.199:9100"
S3_BUCKET = "meetbook-photos"
S3_ACCESS = os.environ.get("S3_ACCESS_KEY", "meetbook_minio")
S3_SECRET = os.environ.get("S3_SECRET_KEY", "meetbook_minio_dev")

OPENLIB_SEARCH = "https://openlibrary.org/search.json"
COVER_ID_TPL = "https://covers.openlibrary.org/b/id/{cover_id}-L.jpg"
COVER_ISBN_TPL = "https://covers.openlibrary.org/b/isbn/{isbn}-L.jpg"

# Placeholder colors by category
PLACEHOLDER_COLORS = {
    "fiction": "4A90D9",
    "non_fiction": "50C878",
    "textbook": "FF6B6B",
    "children": "FFD93D",
    "comics": "9B59B6",
    "poetry": "E67E22",
    "other": "95A5A6",
}


# ── S3 Upload ───────────────────────────────────────────────────────────────────

async def upload_to_s3(book_id: uuid.UUID, filename: str, data: bytes, content_type: str) -> str | None:
    """Upload bytes to MinIO S3 and return the external URL."""
    import aioboto3
    from botocore.config import Config

    key = f"books/{book_id}/{filename}"
    try:
        session = aioboto3.Session()
        async with session.client(
            "s3",
            endpoint_url=S3_ENDPOINT,
            aws_access_key_id=S3_ACCESS,
            aws_secret_access_key=S3_SECRET,
            config=Config(signature_version="s3v4"),
        ) as s3:
            await s3.put_object(
                Bucket=S3_BUCKET,
                Key=key,
                Body=data,
                ContentType=content_type,
            )
        return f"{S3_EXTERNAL}/{S3_BUCKET}/{key}"
    except Exception as e:
        print(f"  ⚠ S3 upload failed for {key}: {e}")
        return None


# ── Placeholder ─────────────────────────────────────────────────────────────────

async def download_placeholder(client: httpx.AsyncClient, title: str, category: str) -> bytes | None:
    """Download a placeholder image from placehold.co."""
    bg = PLACEHOLDER_COLORS.get(category, "95A5A6")
    # URL-encode the title for the placeholder
    import urllib.parse
    label = urllib.parse.quote(title[:30])
    url = f"https://placehold.co/400x600/{bg}/FFFFFF?text={label}&font=roboto"
    try:
        r = await client.get(url, timeout=10)
        if r.status_code == 200 and len(r.content) > 500:
            return r.content
    except Exception:
        pass
    return None


# ── Open Library Search ─────────────────────────────────────────────────────────

async def search_cover_url(
    client: httpx.AsyncClient, title: str, author: str | None, isbn: str | None
) -> str | None:
    """Search Open Library for a cover image URL."""

    # Strategy 1: Title + author search (most reliable for these books)
    # Open Library returns 200 + 1x1 GIF for fake ISBNs, so search is better.

    # Strategy 2: Title + author search
    if author:
        query = f'title:"{title}" author:"{author}"'
    else:
        query = title

    try:
        r = await client.get(
            OPENLIB_SEARCH,
            params={"q": query, "limit": 5},
            timeout=10,
        )
        if r.status_code != 200:
            return None
        data = r.json()
        for doc in data.get("docs", []):
            cover_i = doc.get("cover_i")
            if cover_i:
                return COVER_ID_TPL.format(cover_id=cover_i)
            # Try ISBN from search results
            isbn_list = doc.get("isbn", [])
            for found_isbn in isbn_list:
                if len(found_isbn) == 13:
                    return COVER_ISBN_TPL.format(isbn=found_isbn)
            if isbn_list:
                return COVER_ISBN_TPL.format(isbn=isbn_list[0])
    except Exception:
        pass

    return None


# ── Main ────────────────────────────────────────────────────────────────────────

async def backfill():
    print("=" * 70)
    print("  MeetBook — Book Cover Backfill")
    print("  Open Library → MinIO → Database")
    print("=" * 70)

    factory = get_session_factory()

    # Load all active books
    async with factory() as session:
        result = await session.execute(
            select(Book).where(Book.deleted_at.is_(None)).order_by(Book.created_at)
        )
        books = result.scalars().all()
        print(f"\n  📚 {len(books)} active books loaded")

        # Check which already have photos
        result2 = await session.execute(
            select(BookPhoto.book_id).distinct()
        )
        books_with_photos = {row[0] for row in result2.fetchall()}
        print(f"  📸 {len(books_with_photos)} books already have photos")

    # Filter to books without photos
    books_to_process = [b for b in books if b.id not in books_with_photos]
    print(f"  🔧 {len(books_to_process)} books need covers\n")

    if not books_to_process:
        print("  ✅ All books already have covers! Nothing to do.")
        return

    # Process books
    stats = {"openlib": 0, "placeholder": 0, "failed": 0}

    async with httpx.AsyncClient(timeout=20) as client:
        for idx, book in enumerate(books_to_process, 1):
            cover_url = None
            img_bytes = None

            # Try Open Library
            try:
                cover_url = await search_cover_url(client, book.title, book.author, book.isbn)
            except Exception as e:
                print(f"  ⚠ Search error for '{book.title}': {e}")

            if cover_url:
                # Download the cover (follow redirects, check real size)
                try:
                    img_resp = await client.get(cover_url, timeout=15, follow_redirects=True)
                    # Open Library returns 1x1 GIF (43 bytes) for missing covers
                    if img_resp.status_code == 200 and len(img_resp.content) > 1000:
                        img_bytes = img_resp.content
                    else:
                        cover_url = None
                except Exception:
                    cover_url = None

            if img_bytes:
                # Upload to MinIO
                filename = f"{uuid.uuid7()}.jpg"
                s3_url = await upload_to_s3(book.id, filename, img_bytes, "image/jpeg")
                if s3_url:
                    async with factory() as session:
                        photo = BookPhoto(
                            book_id=book.id,
                            url=s3_url,
                            thumbnail_url=s3_url,
                            position=0,
                            created_at=datetime.now(timezone.utc),
                        )
                        session.add(photo)
                        await session.commit()
                    stats["openlib"] += 1
                    print(f"  [{idx}/{len(books_to_process)}] ✓ {book.title[:45]} (Open Library)")
                else:
                    stats["failed"] += 1
                    print(f"  [{idx}/{len(books_to_process)}] ✗ {book.title[:45]} (S3 upload failed)")
            else:
                # Download placeholder
                cat = book.category.value if book.category else "other"
                placeholder = await download_placeholder(client, book.title, cat)
                if placeholder:
                    filename = f"{uuid.uuid7()}.jpg"
                    s3_url = await upload_to_s3(book.id, filename, placeholder, "image/png")
                    if s3_url:
                        async with factory() as session:
                            photo = BookPhoto(
                                book_id=book.id,
                                url=s3_url,
                                thumbnail_url=s3_url,
                                position=0,
                                created_at=datetime.now(timezone.utc),
                            )
                            session.add(photo)
                            await session.commit()
                        stats["placeholder"] += 1
                        print(f"  [{idx}/{len(books_to_process)}] ◌ {book.title[:45]} (placeholder)")
                    else:
                        stats["failed"] += 1
                        print(f"  [{idx}/{len(books_to_process)}] ✗ {book.title[:45]} (placeholder upload failed)")
                else:
                    stats["failed"] += 1
                    print(f"  [{idx}/{len(books_to_process)}] ✗ {book.title[:45]} (all methods failed)")

            # Rate limiting
            if idx % 10 == 0:
                await asyncio.sleep(0.5)

    # Final verification
    print(f"\n{'=' * 70}")
    print(f"  ✅ Backfill Complete!")
    print(f"  📸 Open Library covers: {stats['openlib']}")
    print(f"  ◌  Placeholders:        {stats['placeholder']}")
    print(f"  ✗  Failed:              {stats['failed']}")
    print(f"  📊 Total processed:     {stats['openlib'] + stats['placeholder'] + stats['failed']}")

    async with factory() as session:
        total_photos = await session.scalar(text("SELECT COUNT(*) FROM book_photos"))
        books_with = await session.scalar(text("SELECT COUNT(DISTINCT book_id) FROM book_photos"))
        total_books = await session.scalar(text("SELECT COUNT(*) FROM books WHERE deleted_at IS NULL"))
        print(f"\n  📋 Database status:")
        print(f"     Total books:       {total_books}")
        print(f"     Books with photos: {books_with}")
        print(f"     Total photo rows:  {total_photos}")

    print(f"{'=' * 70}")


def main():
    return asyncio.run(backfill())


if __name__ == "__main__":
    sys.exit(main())
