#!/usr/bin/env python3
"""Seed 10 books near your location (Istanbul) with real cover images from Open Library.
Run inside backend container:
   cd /app && PYTHONPATH=/app uv run --no-dev python scripts/seed_istanbul.py
"""
import asyncio
import json
import os
import random
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote
from urllib.request import urlopen
from urllib.error import HTTPError, URLError

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ["ENV"] = "development"

from sqlalchemy import select, text
from app.core.db import get_session_factory
from app.modules.books.models import Book, BookPhoto
from app.modules.auth.models import User

# ── YOUR LOCATION (from phone logs) ───────────────────────────────────────
LAT = 41.2899271
LNG = 28.0124611

CONDITIONS = ["new", "like_new", "good", "worn"]

# ── 10 books — covers looked up by title via Open Library API ──────────────
BOOKS = [
    ("Fareler ve İnsanlar",        "John Steinbeck",       "fiction", "tr"),
    ("Çavdar Tarlasında Çocuklar", "J.D. Salinger",        "fiction", "tr"),
    ("Bülbülü Öldürmek",           "Harper Lee",           "fiction", "tr"),
    ("Romeo ve Juliet",            "William Shakespeare",  "fiction", "tr"),
    ("Don Quijote",                "Miguel de Cervantes",  "fiction", "tr"),
    ("Vadideki Zambak",            "Honoré de Balzac",     "fiction", "tr"),
    ("Sefiller",                   "Victor Hugo",          "fiction", "tr"),
    ("Monte Kristo Kontu",         "Alexandre Dumas",      "fiction", "tr"),
    ("Gazap Üzümleri",             "John Steinbeck",       "fiction", "tr"),
    ("Denizler Altında 20.000 Fersah", "Jules Verne",      "fiction", "tr"),
]

COVERS_DIR = Path("/app/media/covers")


def random_location() -> tuple[float, float]:
    lat_offset = random.uniform(-0.045, 0.045)
    lng_offset = random.uniform(-0.045, 0.045)
    return LAT + lat_offset, LNG + lng_offset


def blur_location(lat: float, lng: float, grid: float = 0.01) -> tuple[float, float]:
    return round(lat / grid) * grid, round(lng / grid) * grid


def search_cover_id(title: str, author: str) -> int | None:
    """Search Open Library by title + author, return cover_i if found."""
    query = f"{title} {author.split()[-1]}"
    search_url = f"https://openlibrary.org/search.json?q={quote(query)}&limit=3"
    try:
        with urlopen(search_url, timeout=10) as resp:
            data = json.loads(resp.read().decode())
            for doc in data.get("docs", []):
                cover_i = doc.get("cover_i")
                if cover_i:
                    return cover_i
    except (HTTPError, URLError, OSError, json.JSONDecodeError) as e:
        print(f"    ⚠ Search failed for {title}: {e}")
    return None


def download_cover_by_id(cover_id: int, filename: str, title: str) -> str | None:
    """Download cover from Open Library by cover ID.
    Returns local URL path (/media/covers/{filename}) or None."""
    dest = COVERS_DIR / filename
    if dest.exists():
        return f"/media/covers/{filename}"

    url = f"https://covers.openlibrary.org/b/id/{cover_id}-L.jpg"
    try:
        COVERS_DIR.mkdir(parents=True, exist_ok=True)
        with urlopen(url, timeout=15) as resp:
            data = resp.read()
            if len(data) > 100:  # Skip 1x1 GIF placeholders
                dest.write_bytes(data)
                size_kb = len(data) / 1024
                print(f"    ✅ Downloaded {title} ({size_kb:.0f} KB)")
                return f"/media/covers/{filename}"
            else:
                print(f"    ⚠ Placeholder for {title} ({len(data)} bytes)")
    except HTTPError as e:
        print(f"    ⚠ HTTP {e.code} for {title}")
    except URLError as e:
        print(f"    ⚠ Network error {title}: {e.reason}")
    except OSError as e:
        print(f"    ⚠ File error {title}: {e}")
    return None


async def seed():
    print("=" * 60)
    print("  MeetBook — Seed 10 books near your location")
    print(f"  📍 {LAT}, {LNG}")
    print("=" * 60)

    factory = get_session_factory()
    async with factory() as session:
        # Find canmanici@gmail.com
        result = await session.execute(
            select(User.id).where(User.email == "canmanici@gmail.com")
        )
        row = result.one_or_none()
        if not row:
            print("  ✗ canmanici@gmail.com not found! Run seed.py first.")
            return 1
        owner_id = row[0]
        print(f"  ✓ Owner: canmanici@gmail.com ({owner_id})")

        # Clean up any books from a previous run of THIS script (by looking up isbn pattern)
        await session.execute(
            text("DELETE FROM book_photos WHERE book_id IN (SELECT id FROM books WHERE isbn LIKE 'seed_istanbul_%')")
        )
        await session.execute(
            text("DELETE FROM book_favorites WHERE book_id IN (SELECT id FROM books WHERE isbn LIKE 'seed_istanbul_%')")
        )
        await session.execute(
            text("DELETE FROM exchange_requests WHERE book_id IN (SELECT id FROM books WHERE isbn LIKE 'seed_istanbul_%')")
        )
        await session.execute(
            text("DELETE FROM books WHERE isbn LIKE 'seed_istanbul_%'")
        )
        await session.commit()
        print("  ✓ Cleaned previous seed_istanbul runs")

        now = datetime.now(timezone.utc)

        for idx, (title, author, category, lang) in enumerate(BOOKS, 1):
            lat, lng = random_location()
            pub_lat, pub_lng = blur_location(lat, lng)

            # Use a unique ISBN prefix so we can cleanly re-run
            safe_title = title.lower().replace(" ", "_").replace("ı","i").replace("ü","u").replace("ö","o").replace("ç","c").replace("ş","s").replace("ğ","g")[:30]
            custom_isbn = f"seed_istanbul_{idx:02d}_{safe_title}"

            book = Book(
                owner_id=owner_id,
                title=title,
                author=author,
                isbn=custom_isbn,
                description=f"{title} — {author}",
                category=category,
                language=lang,
                condition=random.choice(CONDITIONS),
                is_available=True,
                location=f"SRID=4326;POINT({lng} {lat})",
                public_location=f"SRID=4326;POINT({pub_lng} {pub_lat})",
                created_at=now,
                updated_at=now,
            )
            session.add(book)
            await session.flush()

            # Search + download cover via Open Library API
            print(f"  [{idx}/10] {title}... ", end="", flush=True)
            cover_id = search_cover_id(title, author)
            if cover_id:
                ext = "jpg"
                fname = f"ol_{cover_id}.{ext}"
                cover_url = download_cover_by_id(cover_id, fname, title)
                if cover_url:
                    session.add(BookPhoto(
                        book_id=book.id,
                        url=cover_url,
                        thumbnail_url=cover_url,
                        position=0,
                    ))
                    print("✅ cover")
                else:
                    print("⚠ placeholder")
            else:
                print("⚠ no cover on Open Library")

        await session.commit()

        # Summary
        total = await session.execute(text("SELECT COUNT(*) FROM books"))
        photos = await session.execute(text("SELECT COUNT(*) FROM book_photos"))
        print(f"\n{'=' * 60}")
        print(f"  ✅ Done! {total.scalar()} total books, {photos.scalar()} covers")
        print(f"  📍 Near {LAT}, {LNG}")

    return 0


def main():
    return asyncio.run(seed())


if __name__ == "__main__":
    sys.exit(main())
