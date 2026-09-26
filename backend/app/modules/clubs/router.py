"""Book club endpoints (/api/v1/clubs)."""

import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_session
from app.modules.auth.dependencies import get_current_user, get_verified_user
from app.modules.auth.models import User
from app.modules.clubs.schemas import (
    ClubBookRequest,
    ClubCreateRequest,
    ClubDetail,
    ClubInviteRequest,
    ClubListResponse,
    ClubMessageCreate,
    ClubMessageListResponse,
    ClubMessageView,
)
from app.modules.clubs.service import ClubError, ClubService

router = APIRouter(prefix="/clubs", tags=["clubs"])


def _svc(session: AsyncSession = Depends(get_session)) -> ClubService:
    return ClubService(session)


def _err(e: ClubError) -> HTTPException:
    return HTTPException(status_code=e.status_code, detail=e.code)


@router.get("", response_model=ClubListResponse)
async def list_my_clubs(
    user: User = Depends(get_current_user), svc: ClubService = Depends(_svc)
) -> ClubListResponse:
    return await svc.list_mine(user.id)


@router.post("", response_model=ClubDetail, status_code=201)
async def create_club(
    body: ClubCreateRequest,
    user: User = Depends(get_verified_user),
    svc: ClubService = Depends(_svc),
) -> ClubDetail:
    try:
        return await svc.create(user.id, body)
    except ClubError as e:
        raise _err(e) from None


@router.get("/{club_id}", response_model=ClubDetail)
async def get_club(
    club_id: uuid.UUID, user: User = Depends(get_current_user), svc: ClubService = Depends(_svc)
) -> ClubDetail:
    try:
        return await svc.detail(club_id, user.id)
    except ClubError as e:
        raise _err(e) from None


@router.delete("/{club_id}", status_code=204)
async def delete_club(
    club_id: uuid.UUID, user: User = Depends(get_current_user), svc: ClubService = Depends(_svc)
) -> Response:
    try:
        await svc.delete(club_id, user.id)
    except ClubError as e:
        raise _err(e) from None
    return Response(status_code=204)


@router.post("/{club_id}/accept", response_model=ClubDetail)
async def accept_invite(
    club_id: uuid.UUID, user: User = Depends(get_verified_user), svc: ClubService = Depends(_svc)
) -> ClubDetail:
    try:
        detail = await svc.respond(club_id, user.id, accept=True)
    except ClubError as e:
        raise _err(e) from None
    assert detail is not None
    return detail


@router.post("/{club_id}/decline", status_code=204)
async def decline_invite(
    club_id: uuid.UUID, user: User = Depends(get_current_user), svc: ClubService = Depends(_svc)
) -> Response:
    try:
        await svc.respond(club_id, user.id, accept=False)
    except ClubError as e:
        raise _err(e) from None
    return Response(status_code=204)


@router.post("/{club_id}/members", response_model=ClubDetail)
async def invite_member(
    club_id: uuid.UUID,
    body: ClubInviteRequest,
    user: User = Depends(get_verified_user),
    svc: ClubService = Depends(_svc),
) -> ClubDetail:
    try:
        return await svc.invite(club_id, user.id, body.user_id)
    except ClubError as e:
        raise _err(e) from None


@router.delete("/{club_id}/members/{member_id}", status_code=204)
async def remove_member(
    club_id: uuid.UUID,
    member_id: uuid.UUID,
    user: User = Depends(get_current_user),
    svc: ClubService = Depends(_svc),
) -> Response:
    """Owner removes a member, or a member leaves (member_id == own id)."""
    try:
        await svc.remove_member(club_id, user.id, member_id)
    except ClubError as e:
        raise _err(e) from None
    return Response(status_code=204)


@router.put("/{club_id}/my-book", response_model=ClubDetail)
async def set_my_book(
    club_id: uuid.UUID,
    body: ClubBookRequest,
    user: User = Depends(get_current_user),
    svc: ClubService = Depends(_svc),
) -> ClubDetail:
    try:
        return await svc.set_my_book(club_id, user.id, body.book_id)
    except ClubError as e:
        raise _err(e) from None


@router.post("/{club_id}/shuffle", response_model=ClubDetail)
async def shuffle(
    club_id: uuid.UUID, user: User = Depends(get_current_user), svc: ClubService = Depends(_svc)
) -> ClubDetail:
    try:
        return await svc.shuffle(club_id, user.id)
    except ClubError as e:
        raise _err(e) from None


@router.get("/{club_id}/messages", response_model=ClubMessageListResponse)
async def list_messages(
    club_id: uuid.UUID,
    before: datetime | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=100),
    user: User = Depends(get_current_user),
    svc: ClubService = Depends(_svc),
) -> ClubMessageListResponse:
    try:
        return await svc.messages(club_id, user.id, before, limit)
    except ClubError as e:
        raise _err(e) from None


@router.post("/{club_id}/messages", response_model=ClubMessageView, status_code=201)
async def post_message(
    club_id: uuid.UUID,
    body: ClubMessageCreate,
    user: User = Depends(get_current_user),
    svc: ClubService = Depends(_svc),
) -> ClubMessageView:
    try:
        return await svc.post_message(club_id, user.id, body.text)
    except ClubError as e:
        raise _err(e) from None
