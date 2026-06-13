"""Places proxy endpoints — Google Places autocomplete/details/nearby, Redis-cached."""

import redis.asyncio as aioredis
from fastapi import APIRouter, Depends, Query

from app.core.redis import get_redis
from app.modules.auth.dependencies import get_current_user
from app.modules.auth.models import User
from app.modules.places import service
from app.modules.places.schemas import AutocompleteResponse, NearbyResponse, PlaceSummary

router = APIRouter(prefix="/places", tags=["places"])


@router.get("/autocomplete", response_model=AutocompleteResponse)
async def autocomplete(
    query: str = Query(..., min_length=1, max_length=200),
    lat: float = Query(..., ge=-90, le=90),
    lng: float = Query(..., ge=-180, le=180),
    user: User = Depends(get_current_user),
    redis: aioredis.Redis = Depends(get_redis),
) -> AutocompleteResponse:
    items = await service.autocomplete(redis, query, lat, lng)
    return AutocompleteResponse(items=items)


@router.get("/details/{place_id}", response_model=PlaceSummary | None)
async def place_details(
    place_id: str,
    user: User = Depends(get_current_user),
    redis: aioredis.Redis = Depends(get_redis),
) -> PlaceSummary | None:
    return await service.details(redis, place_id)


@router.get("/nearby", response_model=NearbyResponse)
async def nearby(
    lat: float = Query(..., ge=-90, le=90),
    lng: float = Query(..., ge=-180, le=180),
    user: User = Depends(get_current_user),
    redis: aioredis.Redis = Depends(get_redis),
) -> NearbyResponse:
    items = await service.nearby(redis, lat, lng)
    return NearbyResponse(items=items)
