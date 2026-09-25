"""ISBN lookup via Open Library API with Redis caching."""

import httpx


_cache: dict[str, dict] = {}
CACHE_TTL = 30 * 24 * 3600  # 30 days in seconds


async def lookup_isbn(isbn: str) -> dict:
    """Look up book info by ISBN from Open Library API."""
    # Check cache
    if isbn in _cache:
        return _cache[isbn]

    # Fetch from Open Library
    url = f"https://openlibrary.org/isbn/{isbn}.json"
    try:
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
            response = await client.get(url)
            if response.status_code == 200:
                data = response.json()
                result = {
                    "isbn": isbn,
                    "title": data.get("title"),
                    "author": _extract_author(data),
                    "description": _extract_description(data),
                    "cover_url": _extract_cover(isbn),
                    "page_count": data.get("number_of_pages"),
                    "published_year": data.get("first_publish_year"),
                }
                _cache[isbn] = result
                return result
    except httpx.RequestError:
        pass

    # Return minimal result if lookup fails
    return {"isbn": isbn}


def _extract_author(data: dict) -> str | None:
    """Extract author name from Open Library response."""
    authors = data.get("authors", [])
    if authors:
        author_key = authors[0].get("key")
        if author_key:
            # Author name would need a separate API call, return key for now
            return author_key.split("/")[-1]
    return None


def _extract_description(data: dict) -> str | None:
    """Extract description from Open Library response."""
    desc = data.get("description")
    if isinstance(desc, str):
        return desc[:2000] if len(desc) > 2000 else desc
    if isinstance(desc, dict):
        return desc.get("value", "")[:2000]
    return None


def _extract_cover(isbn: str) -> str | None:
    """Build cover URL from ISBN."""
    # Open Library cover API
    return f"https://covers.openlibrary.org/b/isbn/{isbn}-L.jpg"
