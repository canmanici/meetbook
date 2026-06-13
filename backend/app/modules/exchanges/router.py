"""Exchange lifecycle endpoints."""

import uuid

import redis.asyncio as aioredis
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_session
from app.core.redis import get_redis
from app.modules.auth.dependencies import get_verified_user
from app.modules.auth.models import User
from app.modules.exchanges.models import ExchangeStatus
from app.modules.exchanges.repository import Role
from app.modules.exchanges.schemas import (
    ExchangeCreateRequest,
    ExchangeDetail,
    ExchangeListResponse,
    MeetupAcceptRequest,
    MeetupProposeRequest,
    MeetupSuggestionsResponse,
)
from app.modules.exchanges.service import ExchangeError, ExchangeService

router = APIRouter(prefix="/exchanges", tags=["exchanges"])


def _get_service(
    session: AsyncSession = Depends(get_session),
    redis: aioredis.Redis = Depends(get_redis),
) -> ExchangeService:
    return ExchangeService(session, redis)


@router.post("", response_model=ExchangeDetail, status_code=201)
async def create_exchange(
    body: ExchangeCreateRequest,
    user: User = Depends(get_verified_user),
    service: ExchangeService = Depends(_get_service),
) -> ExchangeDetail:
    try:
        return await service.create_exchange(user.id, user.completed_exchanges, body)
    except ExchangeError as e:
        raise HTTPException(status_code=e.status_code, detail=e.code)


@router.get("", response_model=ExchangeListResponse)
async def list_exchanges(
    role: Role = Query(...),
    status: ExchangeStatus | None = Query(default=None),
    cursor: str | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=50),
    user: User = Depends(get_verified_user),
    service: ExchangeService = Depends(_get_service),
) -> ExchangeListResponse:
    return await service.list_exchanges(user.id, role, status, cursor, limit)


@router.get("/{exchange_id}", response_model=ExchangeDetail)
async def get_exchange(
    exchange_id: uuid.UUID,
    user: User = Depends(get_verified_user),
    service: ExchangeService = Depends(_get_service),
) -> ExchangeDetail:
    try:
        return await service.get_exchange(exchange_id, user.id)
    except ExchangeError as e:
        raise HTTPException(status_code=e.status_code, detail=e.code)


@router.post("/{exchange_id}/accept", response_model=ExchangeDetail)
async def accept_exchange(
    exchange_id: uuid.UUID,
    user: User = Depends(get_verified_user),
    service: ExchangeService = Depends(_get_service),
) -> ExchangeDetail:
    try:
        return await service.accept(exchange_id, user.id)
    except ExchangeError as e:
        raise HTTPException(status_code=e.status_code, detail=e.code)


@router.post("/{exchange_id}/reject", response_model=ExchangeDetail)
async def reject_exchange(
    exchange_id: uuid.UUID,
    user: User = Depends(get_verified_user),
    service: ExchangeService = Depends(_get_service),
) -> ExchangeDetail:
    try:
        return await service.reject(exchange_id, user.id)
    except ExchangeError as e:
        raise HTTPException(status_code=e.status_code, detail=e.code)


@router.post("/{exchange_id}/cancel", response_model=ExchangeDetail)
async def cancel_exchange(
    exchange_id: uuid.UUID,
    user: User = Depends(get_verified_user),
    service: ExchangeService = Depends(_get_service),
) -> ExchangeDetail:
    try:
        return await service.cancel(exchange_id, user.id)
    except ExchangeError as e:
        raise HTTPException(status_code=e.status_code, detail=e.code)


@router.post("/{exchange_id}/complete", response_model=ExchangeDetail)
async def complete_exchange(
    exchange_id: uuid.UUID,
    user: User = Depends(get_verified_user),
    service: ExchangeService = Depends(_get_service),
) -> ExchangeDetail:
    try:
        return await service.complete(exchange_id, user.id)
    except ExchangeError as e:
        raise HTTPException(status_code=e.status_code, detail=e.code)


@router.post("/{exchange_id}/confirm-completion", response_model=ExchangeDetail)
async def confirm_completion(
    exchange_id: uuid.UUID,
    user: User = Depends(get_verified_user),
    service: ExchangeService = Depends(_get_service),
) -> ExchangeDetail:
    try:
        return await service.confirm_completion(exchange_id, user.id)
    except ExchangeError as e:
        raise HTTPException(status_code=e.status_code, detail=e.code)


@router.post("/{exchange_id}/meetup", response_model=ExchangeDetail)
async def propose_meetup(
    exchange_id: uuid.UUID,
    body: MeetupProposeRequest,
    user: User = Depends(get_verified_user),
    service: ExchangeService = Depends(_get_service),
) -> ExchangeDetail:
    try:
        return await service.propose_meetup(exchange_id, user.id, body)
    except ExchangeError as e:
        raise HTTPException(status_code=e.status_code, detail=e.code)


@router.post("/{exchange_id}/meetup/accept", response_model=ExchangeDetail)
async def accept_meetup(
    exchange_id: uuid.UUID,
    body: MeetupAcceptRequest,
    user: User = Depends(get_verified_user),
    service: ExchangeService = Depends(_get_service),
) -> ExchangeDetail:
    try:
        return await service.accept_meetup(exchange_id, user.id, body)
    except ExchangeError as e:
        raise HTTPException(status_code=e.status_code, detail=e.code)


@router.post("/{exchange_id}/meetup/reject", response_model=ExchangeDetail)
async def reject_meetup(
    exchange_id: uuid.UUID,
    user: User = Depends(get_verified_user),
    service: ExchangeService = Depends(_get_service),
) -> ExchangeDetail:
    try:
        return await service.reject_meetup(exchange_id, user.id)
    except ExchangeError as e:
        raise HTTPException(status_code=e.status_code, detail=e.code)


@router.get("/{exchange_id}/meetup/suggestions", response_model=MeetupSuggestionsResponse)
async def meetup_suggestions(
    exchange_id: uuid.UUID,
    user: User = Depends(get_verified_user),
    service: ExchangeService = Depends(_get_service),
) -> MeetupSuggestionsResponse:
    try:
        items = await service.suggest_meetup_places(exchange_id, user.id)
    except ExchangeError as e:
        raise HTTPException(status_code=e.status_code, detail=e.code)
    return MeetupSuggestionsResponse(items=items)
