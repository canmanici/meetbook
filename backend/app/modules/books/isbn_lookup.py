"""ISBN lookup via Open Library API (in-process cache)."""

import re
from typing import Any

import httpx

from app.core.http import get_http_client
from app.core.ttl_cache import TTLCache

CACHE_TTL = 30 * 24 * 3600  # 30 days in seconds
# Bounded: keys are client-supplied ISBNs (was an unbounded dict that also
# ignored CACHE_TTL). ~2 KB/entry → ≤ ~4 MB.
_cache: TTLCache[str, dict[str, Any]] = TTLCache(maxsize=2000, ttl_seconds=CACHE_TTL)
OL = "https://openlibrary.org"


async def lookup_isbn(isbn: str) -> dict[str, Any]:
    """Look up book info by ISBN from Open Library API."""
    cached = _cache.get(isbn)
    if cached is not None:
        return cached

    try:
        client = get_http_client()
        response = await client.get(f"{OL}/isbn/{isbn}.json", follow_redirects=True)
        if response.status_code == 200:
            data: dict[str, Any] = response.json()
            result = {
                "isbn": isbn,
                "title": data.get("title"),
                "author": await _author_name(client, data),
                "description": _extract_description(data),
                "cover_url": await _cover_url(client, isbn),
                "page_count": data.get("number_of_pages"),
                "published_year": _publish_year(data),
            }
            _cache.set(isbn, result)
            return result
        if response.status_code == 404:
            # Unknown to Open Library: remember briefly so repeated scans of
            # the same barcode don't each cost a ~0.4 s round-trip.
            miss = {"isbn": isbn}
            _cache.set(isbn, miss, ttl_seconds=3600)
            return miss
    except httpx.RequestError:
        pass

    # Return minimal result if lookup fails
    return {"isbn": isbn}


async def _author_name(client: httpx.AsyncClient, edition: dict[str, Any]) -> str | None:
    """Resolve the author's display NAME (the edition only carries an
    /authors/OL…A key; older code returned that key as if it were the name)."""
    keys: list[str] = [
        a["key"] for a in edition.get("authors", []) if isinstance(a, dict) and a.get("key")
    ]
    if not keys:
        # Many editions only link authors through their work record.
        works = edition.get("works") or []
        if works and isinstance(works[0], dict) and works[0].get("key"):
            try:
                w = await client.get(f"{OL}{works[0]['key']}.json", follow_redirects=True)
                if w.status_code == 200:
                    for a in w.json().get("authors", []):
                        key = (a.get("author") or {}).get("key") if isinstance(a, dict) else None
                        if key:
                            keys.append(key)
            except httpx.RequestError:
                return None
    names: list[str] = []
    for key in keys[:3]:
        try:
            r = await client.get(f"{OL}{key}.json", follow_redirects=True)
        except httpx.RequestError:
            continue
        if r.status_code == 200:
            name = r.json().get("name")
            if isinstance(name, str) and name.strip():
                names.append(name.strip())
    return ", ".join(names) or None


def _extract_description(data: dict[str, Any]) -> str | None:
    """Extract description from Open Library response."""
    desc = data.get("description")
    if isinstance(desc, str):
        return desc[:2000]
    if isinstance(desc, dict) and isinstance(desc.get("value"), str):
        return str(desc["value"])[:2000]
    return None


def _publish_year(data: dict[str, Any]) -> int | None:
    """Editions carry `publish_date` ("1998", "March 5, 2001", …), not a year field."""
    raw = data.get("publish_date") or data.get("first_publish_year")
    m = re.search(r"\b(1[5-9]\d\d|20\d\d)\b", str(raw or ""))
    return int(m.group(1)) if m else None


async def _cover_url(client: httpx.AsyncClient, isbn: str) -> str | None:
    """Cover URL only if Open Library really has one (default=false → 404
    instead of a blank 1×1 placeholder image)."""
    url = f"https://covers.openlibrary.org/b/isbn/{isbn}-L.jpg?default=false"
    try:
        r = await client.head(url, follow_redirects=True)
    except httpx.RequestError:
        return None
    return url if r.status_code == 200 else None
