"""Exchange lifecycle endpoints."""

import uuid

import redis.asyncio as aioredis
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_session
from app.core.redis import get_redis
from app.modules.auth.dependencies import get_verified_user
from app.modules.auth.models import User
from app.modules.exchanges.models import ExchangeStatus
from app.modules.exchanges.repository import Role
from app.modules.exchanges.schemas import (
    BlockCreateRequest,
    BlockListResponse,
    ExchangeCreateRequest,
    ExchangeDetail,
    ExchangeListResponse,
    ExtensionRequestBody,
    LendRequest,
    MeetupAcceptRequest,
    MeetupProposeRequest,
    MeetupSuggestionsResponse,
    ReadingBuddyView,
    ReturnRequest,
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


@router.post("/blocks", status_code=204)
async def block_user(
    body: BlockCreateRequest,
    user: User = Depends(get_verified_user),
    service: ExchangeService = Depends(_get_service),
) -> None:
    try:
        await service.block_user(user.id, body.user_id)
    except ExchangeError as e:
        raise HTTPException(status_code=e.status_code, detail=e.code)


@router.get("/blocks", response_model=BlockListResponse)
async def list_blocked_users(
    user: User = Depends(get_verified_user),
    service: ExchangeService = Depends(_get_service),
) -> BlockListResponse:
    return await service.list_blocked_users(user.id)


@router.delete("/blocks/{blocked_user_id}", status_code=204)
async def unblock_user(
    blocked_user_id: uuid.UUID,
    user: User = Depends(get_verified_user),
    service: ExchangeService = Depends(_get_service),
) -> None:
    await service.unblock_user(user.id, blocked_user_id)


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


class LoanPhotoResponse(BaseModel):
    url: str


@router.post("/{exchange_id}/photo", response_model=LoanPhotoResponse)
async def upload_loan_photo(
    exchange_id: uuid.UUID,
    file: UploadFile = File(...),
    user: User = Depends(get_verified_user),
    service: ExchangeService = Depends(_get_service),
) -> LoanPhotoResponse:
    file_bytes = await file.read()
    if len(file_bytes) > 10 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Photo too large (max 10MB)")
    try:
        url = await service.upload_loan_photo(
            exchange_id, user.id, file_bytes, file.content_type or "image/jpeg"
        )
    except ExchangeError as e:
        raise HTTPException(status_code=e.status_code, detail=e.code)
    return LoanPhotoResponse(url=url)


@router.post("/{exchange_id}/lend", response_model=ExchangeDetail)
async def lend_book(
    exchange_id: uuid.UUID,
    body: LendRequest,
    user: User = Depends(get_verified_user),
    service: ExchangeService = Depends(_get_service),
) -> ExchangeDetail:
    try:
        return await service.lend(exchange_id, user.id, body)
    except ExchangeError as e:
        raise HTTPException(status_code=e.status_code, detail=e.code)


@router.post("/{exchange_id}/return", response_model=ExchangeDetail)
async def return_book(
    exchange_id: uuid.UUID,
    body: ReturnRequest,
    user: User = Depends(get_verified_user),
    service: ExchangeService = Depends(_get_service),
) -> ExchangeDetail:
    try:
        return await service.mark_returned(exchange_id, user.id, body)
    except ExchangeError as e:
        raise HTTPException(status_code=e.status_code, detail=e.code)


@router.post("/{exchange_id}/confirm-return", response_model=ExchangeDetail)
async def confirm_return(
    exchange_id: uuid.UUID,
    user: User = Depends(get_verified_user),
    service: ExchangeService = Depends(_get_service),
) -> ExchangeDetail:
    try:
        return await service.confirm_return(exchange_id, user.id)
    except ExchangeError as e:
        raise HTTPException(status_code=e.status_code, detail=e.code)


@router.post("/{exchange_id}/extension", response_model=ExchangeDetail)
async def request_extension(
    exchange_id: uuid.UUID,
    body: ExtensionRequestBody,
    user: User = Depends(get_verified_user),
    service: ExchangeService = Depends(_get_service),
) -> ExchangeDetail:
    try:
        return await service.request_extension(exchange_id, user.id, body)
    except ExchangeError as e:
        raise HTTPException(status_code=e.status_code, detail=e.code)


@router.post("/{exchange_id}/extension/approve", response_model=ExchangeDetail)
async def approve_extension(
    exchange_id: uuid.UUID,
    user: User = Depends(get_verified_user),
    service: ExchangeService = Depends(_get_service),
) -> ExchangeDetail:
    try:
        return await service.respond_extension(exchange_id, user.id, approve=True)
    except ExchangeError as e:
        raise HTTPException(status_code=e.status_code, detail=e.code)


@router.post("/{exchange_id}/extension/reject", response_model=ExchangeDetail)
async def reject_extension(
    exchange_id: uuid.UUID,
    user: User = Depends(get_verified_user),
    service: ExchangeService = Depends(_get_service),
) -> ExchangeDetail:
    try:
        return await service.respond_extension(exchange_id, user.id, approve=False)
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


@router.put("/{exchange_id}/meetup", response_model=ExchangeDetail)
async def reschedule_meetup(
    exchange_id: uuid.UUID,
    body: MeetupProposeRequest,
    user: User = Depends(get_verified_user),
    service: ExchangeService = Depends(_get_service),
) -> ExchangeDetail:
    try:
        return await service.reschedule_meetup(exchange_id, user.id, body)
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


# ---------------------------------------------------------------------------
# B20: Book Retirement Flow
# ---------------------------------------------------------------------------


@router.post("/{exchange_id}/retire-book", response_model=ExchangeDetail)
async def retire_book(
    exchange_id: uuid.UUID,
    user: User = Depends(get_verified_user),
    service: ExchangeService = Depends(_get_service),
) -> ExchangeDetail:
    try:
        return await service.retire_book(exchange_id, user.id)
    except ExchangeError as e:
        raise HTTPException(status_code=e.status_code, detail=e.code)


# ---------------------------------------------------------------------------
# B24: Reading Buddy Matching
# ---------------------------------------------------------------------------


@router.post("/{exchange_id}/reading-buddy", response_model=ReadingBuddyView, status_code=201)
async def create_reading_buddy(
    exchange_id: uuid.UUID,
    user: User = Depends(get_verified_user),
    service: ExchangeService = Depends(_get_service),
) -> ReadingBuddyView:
    try:
        return await service.create_reading_buddy(exchange_id, user.id)
    except ExchangeError as e:
        raise HTTPException(status_code=e.status_code, detail=e.code)


@router.post("/{exchange_id}/reading-buddy/accept", response_model=ReadingBuddyView)
async def accept_reading_buddy(
    exchange_id: uuid.UUID,
    user: User = Depends(get_verified_user),
    service: ExchangeService = Depends(_get_service),
) -> ReadingBuddyView:
    try:
        return await service.accept_reading_buddy(exchange_id, user.id, accept=True)
    except ExchangeError as e:
        raise HTTPException(status_code=e.status_code, detail=e.code)


@router.post("/{exchange_id}/reading-buddy/decline", response_model=ReadingBuddyView)
async def decline_reading_buddy(
    exchange_id: uuid.UUID,
    user: User = Depends(get_verified_user),
    service: ExchangeService = Depends(_get_service),
) -> ReadingBuddyView:
    try:
        return await service.accept_reading_buddy(exchange_id, user.id, accept=False)
    except ExchangeError as e:
        raise HTTPException(status_code=e.status_code, detail=e.code)
