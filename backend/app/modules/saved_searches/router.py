"""Saved searches endpoints."""
import uuid
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.db import get_session
from app.modules.auth.dependencies import get_current_user
from app.modules.auth.models import User
from app.modules.saved_searches.schemas import (
    SavedSearchCreate,
    SavedSearchUpdate,
    SavedSearchView,
    SavedSearchListResponse,
)
from app.modules.saved_searches.service import SavedSearchError, SavedSearchService

router = APIRouter(prefix="/saved-searches", tags=["saved-searches"])


def _get_service(session: AsyncSession = Depends(get_session)) -> SavedSearchService:
    return SavedSearchService(session)


@router.get("", response_model=SavedSearchListResponse)
async def list_saved_searches(
    user: User = Depends(get_current_user),
    service: SavedSearchService = Depends(_get_service),
) -> SavedSearchListResponse:
    return await service.list_by_user(user.id)


@router.post("", response_model=SavedSearchView, status_code=201)
async def create_saved_search(
    body: SavedSearchCreate,
    user: User = Depends(get_current_user),
    service: SavedSearchService = Depends(_get_service),
) -> SavedSearchView:
    try:
        return await service.create(user.id, body)
    except SavedSearchError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)


@router.get("/{search_id}", response_model=SavedSearchView)
async def get_saved_search(
    search_id: uuid.UUID,
    user: User = Depends(get_current_user),
    service: SavedSearchService = Depends(_get_service),
) -> SavedSearchView:
    try:
        return await service.get_by_id(search_id, user.id)
    except SavedSearchError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)


@router.put("/{search_id}", response_model=SavedSearchView)
async def update_saved_search(
    search_id: uuid.UUID,
    body: SavedSearchUpdate,
    user: User = Depends(get_current_user),
    service: SavedSearchService = Depends(_get_service),
) -> SavedSearchView:
    try:
        return await service.update(search_id, user.id, body)
    except SavedSearchError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)


@router.delete("/{search_id}", status_code=204)
async def delete_saved_search(
    search_id: uuid.UUID,
    user: User = Depends(get_current_user),
    service: SavedSearchService = Depends(_get_service),
) -> None:
    try:
        await service.delete(search_id, user.id)
    except SavedSearchError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)
