#!/usr/bin/env python3
"""Seed 100 real books near Antalya with real cover photos from Open Library.

Fetches book data from Open Library API (free, no auth needed), downloads cover
images, uploads them to MinIO, and inserts everything into the database.

Usage:
    docker cp scripts/seed_100_books.py meetbook-backend-1:/app/scripts/
    docker exec meetbook-backend-1 bash -c "cd /app && PYTHONPATH=/app uv run --no-dev python scripts/seed_100_books.py"
"""

import asyncio
import io
import json
import logging
import os
import random
import sys
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

import httpx

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger(__name__)

# ── Configuration ─────────────────────────────────────────────────────────────

ANTALYA_LAT = 36.8752
ANTALYA_LNG = 30.7072
BOOKS_PER_CATEGORY = {
    "fiction": 20,
    "non_fiction": 15,
    "textbook": 15,
    "children": 15,
    "comics": 10,
    "poetry": 10,
    "other": 15,
}

# Open Library search subjects mapped to our categories
CATEGORY_SEARCH_QUERIES = {
    "fiction": [
        "subject:fiction", "subject:novel", "subject:roman",
        "subject:classic_literature", "subject:fantasy",
    ],
    "non_fiction": [
        "subject:non-fiction", "subject:history", "subject:science",
        "subject:philosophy", "subject:biography",
    ],
    "textbook": [
        "subject:textbook", "subject:mathematics", "subject:physics",
        "subject:computer_science", "subject:medicine",
    ],
    "children": [
        "subject:children", "subject:childrens_literature",
        "subject:childrens_stories", "subject:juvenile_fiction",
        "subject:fairy_tales",
    ],
    "comics": [
        "subject:comics", "subject:graphic_novels", "subject:manga",
        "subject:cartoons", "subject:comic_books",
    ],
    "poetry": [
        "subject:poetry", "subject:poems", "subject:poetry_collections",
        "subject:turkish_poetry", "subject:world_poetry",
    ],
    "other": [
        "subject:short_stories", "subject:essays",
        "subject:travel", "subject:cooking", "subject:art",
    ],
}

# Turkish language books search (parallel queries for each category)
TR_CATEGORY_QUERIES = {
    "fiction": ["subject:turkish_fiction", "subject:turkish_novel", "subject:turkish_literature"],
    "non_fiction": ["subject:turkish_non-fiction", "subject:turkish_history"],
    "poetry": ["subject:turkish_poetry"],
    "children": ["subject:turkish_children"],
}

# Conditions to cycle through
CONDITIONS = ["new", "like_new", "good", "worn"]

LANGUAGES = ["tr", "en", "fr", "de", "es"]

EXISTING_USERS = [
    "30217149-0ca8-482c-8e16-0af8c55119a3",  # Arif
    "65d5f1c6-610c-4b84-b2b6-779aa9061262",  # Habib Doğan
    "7ed9e0d7-f21c-40a5-8c84-58b2e3865240",  # Emir
    "9130ac1e-b945-4cba-ae82-301577e7a3f9",  # Admin
    "2ce5e764-7d2b-4ba7-b26f-6a3228e6c5f6",  # Demo User
    "4998a113-ca1e-4dba-a19d-f8f86d95bdf4",  # Test User 1
]

S3_CONFIG = {
    "endpoint_url": "http://minio:9000",
    "external_endpoint": "http://192.168.8.199:9100",
    "bucket": "meetbook-photos",
    "access_key": "meetbook_minio",
    "secret_key": "meetbook_minio_dev",
}


# ── Data Structures ───────────────────────────────────────────────────────────

@dataclass
class BookInfo:
    title: str
    author: str | None
    isbn: str | None
    description: str | None
    cover_id: int | None
    category: str
    language: str
    ol_olid: str | None


# ── Open Library API ──────────────────────────────────────────────────────────


async def search_ol(client: httpx.AsyncClient, query: str, limit: int = 30) -> list[dict]:
    """Search Open Library and return raw results."""
    url = "https://openlibrary.org/search.json"
    params = {"q": query, "limit": min(limit, 100), "fields": "title,author_name,isbn,subject,cover_i,first_publish_year,key,seed,language"}
    try:
        resp = await client.get(url, params=params, timeout=15.0)
        resp.raise_for_status()
        data = resp.json()
        return data.get("docs", [])
    except Exception as e:
        logger.warning(f"  ⚠ Open Library search failed for '{query}': {e}")
        return []


async def get_work_details(client: httpx.AsyncClient, olid: str) -> dict | None:
    """Get work details including description."""
    url = f"https://openlibrary.org{olid}.json"
    try:
        resp = await client.get(url, timeout=10.0)
        resp.raise_for_status()
        return resp.json()
    except Exception:
        return None


def parse_description(work_data: dict | None) -> str | None:
    if not work_data:
        return None
    desc = work_data.get("description")
    if isinstance(desc, str):
        return desc[:500] if desc else None
    if isinstance(desc, dict):
        val = desc.get("value", "")
        return val[:500] if val else None
    return None


async def fetch_books_for_category(
    client: httpx.AsyncClient,
    category: str,
    target_count: int,
) -> list[BookInfo]:
    """Fetch enough real books for a category from Open Library."""
    books: dict[str, BookInfo] = {}  # deduplicate by title+author
    queries = CATEGORY_SEARCH_QUERIES.get(category, ["subject:books"])
    tr_queries = TR_CATEGORY_QUERIES.get(category, [])

    # Try Turkish queries first (for Turkish-relevant content)
    all_queries = tr_queries + queries
    random.shuffle(all_queries)

    for query in all_queries:
        if len(books) >= target_count:
            break
        results = await search_ol(client, query, limit=40)
        random.shuffle(results)

        for doc in results:
            if len(books) >= target_count:
                break
            title = doc.get("title")
            if not title or len(title) < 2:
                continue

            author = doc.get("author_name", [None])[0] if doc.get("author_name") else None
            isbns = doc.get("isbn", [])
            isbn = None
            # Prefer ISBN-13
            for i in isbns or []:
                if len(i) == 13:
                    isbn = i
                    break
            if not isbn and isbns:
                isbn = isbns[0]

            cover_id = doc.get("cover_i")
            ol_key = doc.get("key", "")
            languages = doc.get("language", [])

            # Determine language
            lang = "en"
            if languages:
                lang_choices = [l for l in languages if len(l) <= 3]
                if lang_choices:
                    lang = lang_choices[0]
            # If from Turkish query, force Turkish
            if query in tr_queries:
                lang = "tr"

            dedup_key = f"{title.lower().strip()}|{author or 'unknown'}"
            if dedup_key not in books:
                # Get description from work details
                work_data = None
                if ol_key:
                    work_data = await get_work_details(client, ol_key)
                    await asyncio.sleep(0.15)  # Rate limiting

                description = parse_description(work_data)
                if not description and doc.get("subject"):
                    desc = doc["subject"][0] if isinstance(doc["subject"], list) else doc["subject"]
                    description = str(desc)[:300] if desc else None

                books[dedup_key] = BookInfo(
                    title=title[:200],
                    author=author[:200] if author else None,
                    isbn=isbn[:20] if isbn else None,
                    description=description[:2000] if description else None,
                    cover_id=cover_id,
                    category=category,
                    language=lang if len(lang) <= 10 else "en",
                    ol_olid=ol_key.strip("/") if ol_key else None,
                )

        await asyncio.sleep(0.3)  # Rate limiting between queries

    result = list(books.values())
    logger.info(f"  ✓ {category}: fetched {len(result)} books")
    return result


# ── Photo Handling ────────────────────────────────────────────────────────────


async def download_cover(client: httpx.AsyncClient, cover_id: int) -> bytes | None:
    """Download cover image from Open Library."""
    for size in ["L", "M"]:
        url = f"https://covers.openlibrary.org/b/id/{cover_id}-{size}.jpg"
        try:
            resp = await client.get(url, timeout=15.0)
            if resp.status_code == 200 and len(resp.content) > 1000:
                return resp.content
        except Exception:
            continue
    return None


async def upload_to_minio(
    book_id: uuid.UUID,
    cover_bytes: bytes,
) -> str | None:
    """Upload cover image to MinIO S3 and return the URL."""
    import aioboto3
    from botocore.config import Config

    filename = f"{uuid.uuid4()}.jpg"
    key = f"books/{book_id}/{filename}"

    try:
        session = aioboto3.Session()
        async with session.client(
            "s3",
            endpoint_url=S3_CONFIG["endpoint_url"],
            aws_access_key_id=S3_CONFIG["access_key"],
            aws_secret_access_key=S3_CONFIG["secret_key"],
            config=Config(signature_version="s3v4"),
        ) as s3:
            await s3.put_object(
                Bucket=S3_CONFIG["bucket"],
                Key=key,
                Body=cover_bytes,
                ContentType="image/jpeg",
            )

        external = S3_CONFIG["external_endpoint"]
        url = f"{external}/{S3_CONFIG['bucket']}/{key}"
        return url
    except Exception as e:
        logger.warning(f"  ⚠ MinIO upload failed for {key}: {e}")
        return None


# ── Database ──────────────────────────────────────────────────────────────────


async def insert_book(
    conn: Any,
    book: BookInfo,
    owner_id: uuid.UUID,
    location_wkt: str,
    public_location_wkt: str,
    condition: str,
) -> uuid.UUID | None:
    """Insert a book into the database and return its ID."""
    from geoalchemy2.elements import WKTElement

    book_id = uuid.uuid4()
    now = datetime.now(timezone.utc)
    isbn = book.isbn or f"SEED-{uuid.uuid4().hex[:12].upper()}"

    try:
        await conn.execute(
            """INSERT INTO books (id, owner_id, title, author, isbn, description,
                                  category, language, condition, is_available,
                                  location, public_location, view_count, favorite_count,
                                  created_at, updated_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                       $11::geography, $12::geography, 0, 0, $13, $14)
               ON CONFLICT (id) DO NOTHING""",
            book_id,
            owner_id,
            book.title,
            book.author,
            isbn,
            book.description or f"A {book.category} book titled '{book.title}'.",
            book.category,
            book.language[:10],
            condition,
            True,
            location_wkt,
            public_location_wkt,
            now,
            now,
        )
        return book_id
    except Exception as e:
        logger.warning(f"  ⚠ Failed to insert book '{book.title}': {e}")
        return None


async def insert_photo(conn: Any, book_id: uuid.UUID, url: str, position: int) -> bool:
    """Insert a book photo record."""
    try:
        await conn.execute(
            """INSERT INTO book_photos (id, book_id, url, position, created_at)
               VALUES ($1, $2, $3, $4, $5)
               ON CONFLICT (id) DO NOTHING""",
            uuid.uuid4(),
            book_id,
            url,
            position,
            datetime.now(timezone.utc),
        )
        return True
    except Exception as e:
        logger.warning(f"  ⚠ Failed to insert photo for book {book_id}: {e}")
        return False


# ── Location Generation ───────────────────────────────────────────────────────


def random_location_near_antalya() -> tuple[float, float]:
    """Generate a random location within ~5km of Antalya center."""
    # ~0.045 degrees ≈ 5km
    lat_offset = random.uniform(-0.045, 0.045)
    lng_offset = random.uniform(-0.045, 0.045)
    return ANTALYA_LAT + lat_offset, ANTALYA_LNG + lng_offset


def blur_location(lat: float, lng: float, grid: float = 0.01) -> tuple[float, float]:
    """Snap to a ~1.1km grid (same as core.geo.blur)."""
    return round(lat / grid) * grid, round(lng / grid) * grid


# ── Main Seeding Logic ────────────────────────────────────────────────────────


async def seed() -> int:
    print("=" * 70)
    print("  MeetBook — 100 Real Books Seeder (Antalya)")
    print("=" * 70)

    # ── 1. Fetch books from Open Library ──────────────────────────────────
    print("\n── Fetching books from Open Library API ──────────────────────────")
    async with httpx.AsyncClient() as client:
        all_books: list[BookInfo] = []
        total_target = sum(BOOKS_PER_CATEGORY.values())

        for category, target_count in BOOKS_PER_CATEGORY.items():
            books = await fetch_books_for_category(client, category, target_count)
            # Take only what we need
            all_books.extend(books[:target_count])
            await asyncio.sleep(0.5)  # Rate limiting between categories

    if not all_books:
        logger.error("✗ No books fetched from Open Library. Cannot continue.")
        return 1

    logger.info(f"\n  Total books fetched: {len(all_books)} (target: {total_target})")

    # ── 2. Connect to database ────────────────────────────────────────────
    print("\n── Connecting to database ────────────────────────────────────────")
    try:
        import asyncpg

        dsn = os.environ.get(
            "DATABASE_URL",
            "postgresql://meetbook:meetbook_dev@db:5432/meetbook"
        )
        # asyncpg doesn't use full URL, extract parts
        conn = await asyncpg.connect(
            user="meetbook",
            password="meetbook_dev",
            host="db",
            port=5432,
            database="meetbook",
        )
        logger.info("  ✓ Connected to PostgreSQL")
    except Exception as e:
        logger.error(f"  ✗ Database connection failed: {e}")
        return 1

    try:
        # ── 3. Process each book ──────────────────────────────────────────
        print(f"\n── Seeding {len(all_books)} books with photos ─────────────────")
        seeded_count = 0
        photo_count = 0
        skipped_count = 0

        async with httpx.AsyncClient() as client:
            for idx, book in enumerate(all_books, 1):
                owner_id = uuid.UUID(random.choice(EXISTING_USERS))
                condition = random.choice(CONDITIONS)

                # Generate location
                lat, lng = random_location_near_antalya()
                public_lat, public_lng = blur_location(lat, lng)
                location_wkt = f"SRID=4326;POINT({lng} {lat})"
                public_wkt = f"SRID=4326;POINT({public_lng} {public_lat})"

                # Insert book
                book_id = await insert_book(
                    conn, book, owner_id, location_wkt, public_wkt, condition
                )
                if not book_id:
                    skipped_count += 1
                    continue

                # Try to get cover image
                if book.cover_id:
                    cover_bytes = await download_cover(client, book.cover_id)
                    if cover_bytes:
                        url = await upload_to_minio(book_id, cover_bytes)
                        if url:
                            await insert_photo(conn, book_id, url, 0)
                            photo_count += 1

                seeded_count += 1

                if idx % 10 == 0 or idx == len(all_books):
                    logger.info(f"  {idx}/{len(all_books)} books processed ({seeded_count} seeded, {skipped_count} skipped, {photo_count} photos)")

                # Rate limiting for Open Library covers
                if book.cover_id and idx % 5 == 0:
                    await asyncio.sleep(0.2)

        # ── 4. Summary ────────────────────────────────────────────────────
        print(f"\n{'=' * 70}")
        print(f"  ✅ Seeding Complete!")
        print(f"  📚 Books seeded: {seeded_count}")
        print(f"  📸 Photos uploaded: {photo_count}")
        print(f"  ⏭  Skipped: {skipped_count}")
        print(f"  📍 Location: Antalya, Turkey ({ANTALYA_LAT}, {ANTALYA_LNG})")

        # Verify
        print(f"\n── Verification ─────────────────────────────────────────────")
        row_count = await conn.fetchval("SELECT COUNT(*) FROM books")
        photo_row_count = await conn.fetchval("SELECT COUNT(*) FROM book_photos")
        print(f"  Total books in database: {row_count}")
        print(f"  Total photos in database: {photo_row_count}")

        # Show category breakdown
        categories = await conn.fetch(
            "SELECT category, COUNT(*) as cnt FROM books WHERE deleted_at IS NULL GROUP BY category ORDER BY cnt DESC"
        )
        print(f"\n  Category breakdown:")
        for row in categories:
            print(f"    • {row['category']}: {row['cnt']}")

        return 0

    except Exception as e:
        logger.error(f"  ✗ Seeding failed: {e}")
        import traceback
        traceback.print_exc()
        return 1
    finally:
        await conn.close()


def main() -> int:
    return asyncio.run(seed())


if __name__ == "__main__":
    sys.exit(main())
