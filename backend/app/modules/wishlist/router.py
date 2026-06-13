"""Wishlist endpoints."""

import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_session
from app.modules.auth.dependencies import get_current_user, get_verified_user
from app.modules.auth.models import User
from app.modules.wishlist.schemas import (
    WishlistItemCreateRequest,
    WishlistItemView,
    WishlistListResponse,
    WishlistMatchResponse,
)
from app.modules.wishlist.service import WishlistError, WishlistService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/wishlist", tags=["wishlist"])


def _get_service(session: AsyncSession = Depends(get_session)) -> WishlistService:
    return WishlistService(session)


@router.get("", response_model=WishlistListResponse)
async def list_wishlist(
    user: User = Depends(get_current_user),
    service: WishlistService = Depends(_get_service),
) -> WishlistListResponse:
    return await service.list_items(user.id)


@router.post("", response_model=WishlistItemView, status_code=201)
async def add_wishlist_item(
    body: WishlistItemCreateRequest,
    user: User = Depends(get_verified_user),
    service: WishlistService = Depends(_get_service),
) -> WishlistItemView:
    try:
        logger.info("Adding to wishlist: user=%s, isbn=%s", user.id, body.isbn)
        return await service.add_item(user.id, body)
    except WishlistError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)


@router.delete("/{item_id}", status_code=204)
async def delete_wishlist_item(
    item_id: uuid.UUID,
    user: User = Depends(get_current_user),
    service: WishlistService = Depends(_get_service),
) -> None:
    try:
        await service.delete_item(user.id, item_id)
    except WishlistError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)


@router.get("/matches", response_model=WishlistMatchResponse)
async def find_wishlist_matches(
    user: User = Depends(get_current_user),
    service: WishlistService = Depends(_get_service),
) -> WishlistMatchResponse:
    return await service.find_matches(user.id)
