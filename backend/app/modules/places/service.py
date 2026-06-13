"""Google Places proxy with Redis caching.

Degrades gracefully (returns empty results) when `google_places_key` is unset,
same pattern as `app.modules.books.isbn_lookup`.
"""

import hashlib
import json

import httpx
import redis.asyncio as aioredis

from app.core.config import get_settings
from app.modules.places.schemas import PlaceSummary

BASE_URL = "https://maps.googleapis.com/maps/api/place"

AUTOCOMPLETE_TTL = 60 * 60  # 1 hour
DETAILS_TTL = 7 * 24 * 60 * 60  # 7 days
NEARBY_TTL = 24 * 60 * 60  # 1 day

# Google Places "type" values that are considered safe meetup locations.
SAFE_CATEGORIES = {
    "cafe",
    "library",
    "book_store",
    "shopping_mall",
    "university",
    "transit_station",
    "restaurant",
    "park",
}


def _cache_key(kind: str, params: dict) -> str:
    raw = json.dumps(params, sort_keys=True)
    digest = hashlib.sha256(raw.encode()).hexdigest()
    return f"places:{kind}:{digest}"


def _category_for_types(types: list[str]) -> str | None:
    for t in types:
        if t in SAFE_CATEGORIES:
            return t
    return None


async def autocomplete(redis: aioredis.Redis, query: str, lat: float, lng: float) -> list[dict]:
    settings = get_settings()
    if not settings.google_places_key:
        return []

    params = {"query": query, "lat": round(lat, 3), "lng": round(lng, 3)}
    key = _cache_key("autocomplete", params)
    cached = await redis.get(key)
    if cached is not None:
        return json.loads(cached)

    req_params = {
        "input": query,
        "key": settings.google_places_key,
        "language": "tr",
        "location": f"{lat},{lng}",
        "radius": 50000,
    }
    async with httpx.AsyncClient(timeout=10.0) as client:
        response = await client.get(f"{BASE_URL}/autocomplete/json", params=req_params)
        data = response.json()

    items = [
        {"place_id": p["place_id"], "description": p.get("description", "")}
        for p in data.get("predictions", [])
    ]
    await redis.set(key, json.dumps(items), ex=AUTOCOMPLETE_TTL)
    return items


async def details(redis: aioredis.Redis, place_id: str) -> PlaceSummary | None:
    settings = get_settings()
    if not settings.google_places_key:
        return None

    key = _cache_key("details", {"place_id": place_id})
    cached = await redis.get(key)
    if cached is not None:
        data = json.loads(cached)
        return PlaceSummary(**data) if data else None

    req_params = {
        "place_id": place_id,
        "key": settings.google_places_key,
        "language": "tr",
        "fields": "name,formatted_address,geometry,type,place_id",
    }
    async with httpx.AsyncClient(timeout=10.0) as client:
        response = await client.get(f"{BASE_URL}/details/json", params=req_params)
        data = response.json()

    result = data.get("result")
    if not result:
        await redis.set(key, json.dumps(None), ex=DETAILS_TTL)
        return None

    location = result.get("geometry", {}).get("location", {})
    summary = PlaceSummary(
        place_id=result.get("place_id", place_id),
        name=result.get("name", ""),
        address=result.get("formatted_address"),
        category=_category_for_types(result.get("types", [])),
        lat=location.get("lat", 0.0),
        lng=location.get("lng", 0.0),
    )
    await redis.set(key, summary.model_dump_json(), ex=DETAILS_TTL)
    return summary


async def nearby(
    redis: aioredis.Redis, lat: float, lng: float, types: set[str] | None = None
) -> list[PlaceSummary]:
    settings = get_settings()
    if not settings.google_places_key:
        return []

    search_types = sorted(types or SAFE_CATEGORIES)
    params = {"lat": round(lat, 4), "lng": round(lng, 4), "types": search_types}
    key = _cache_key("nearby", params)
    cached = await redis.get(key)
    if cached is not None:
        return [PlaceSummary(**item) for item in json.loads(cached)]

    seen: dict[str, PlaceSummary] = {}
    async with httpx.AsyncClient(timeout=10.0) as client:
        for place_type in search_types:
            req_params = {
                "location": f"{lat},{lng}",
                "radius": 2000,
                "type": place_type,
                "key": settings.google_places_key,
                "language": "tr",
            }
            response = await client.get(f"{BASE_URL}/nearbysearch/json", params=req_params)
            data = response.json()
            for result in data.get("results", []):
                place_id = result.get("place_id")
                if place_id is None or place_id in seen:
                    continue
                location = result.get("geometry", {}).get("location", {})
                seen[place_id] = PlaceSummary(
                    place_id=place_id,
                    name=result.get("name", ""),
                    address=result.get("vicinity"),
                    category=_category_for_types(result.get("types", [])) or place_type,
                    lat=location.get("lat", 0.0),
                    lng=location.get("lng", 0.0),
                )
            if len(seen) >= 20:
                break

    items = list(seen.values())[:20]
    await redis.set(key, json.dumps([item.model_dump() for item in items]), ex=NEARBY_TTL)
    return items
