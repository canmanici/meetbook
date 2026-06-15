"""Ratings endpoints."""

import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_session
from app.modules.auth.dependencies import get_verified_user
from app.modules.auth.models import User
from app.modules.ratings.schemas import RatingCreateRequest, RatingListResponse, RatingView
from app.modules.ratings.service import RatingError, RatingService

router = APIRouter(tags=["ratings"])


def _get_service(session: AsyncSession = Depends(get_session)) -> RatingService:
    return RatingService(session)


@router.post("/ratings", response_model=RatingView, status_code=201)
async def create_rating(
    body: RatingCreateRequest,
    user: User = Depends(get_verified_user),
    service: RatingService = Depends(_get_service),
) -> RatingView:
    try:
        return await service.create_rating(user.id, body)
    except RatingError as e:
        raise HTTPException(status_code=e.status_code, detail=e.code)


@router.get("/users/{user_id}/ratings", response_model=RatingListResponse)
async def get_user_ratings(
    user_id: uuid.UUID,
    user: User = Depends(get_verified_user),
    service: RatingService = Depends(_get_service),
) -> RatingListResponse:
    return await service.get_user_ratings(user_id)
