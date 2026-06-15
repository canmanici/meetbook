"""Admin moderation endpoints — role-gated via `get_admin_user`."""

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_session
from app.modules.admin.schemas import (
    AdminReportListResponse,
    AdminReportView,
    AdminUserView,
    BlockedPlaceCreateRequest,
    BlockedPlaceListResponse,
    BlockedPlaceView,
    MetricsResponse,
    ReportResolveRequest,
    UserActionRequest,
)
from app.modules.admin.service import AdminError, AdminService
from app.modules.auth.dependencies import get_admin_user
from app.modules.auth.models import User
from app.modules.reports.models import ReportStatus

router = APIRouter(prefix="/admin", tags=["admin"])


def _get_service(session: AsyncSession = Depends(get_session)) -> AdminService:
    return AdminService(session)


@router.get("/reports", response_model=AdminReportListResponse)
async def list_reports(
    status: ReportStatus | None = Query(default=None),
    user: User = Depends(get_admin_user),
    service: AdminService = Depends(_get_service),
) -> AdminReportListResponse:
    return await service.list_reports(status)


@router.post("/reports/{report_id}/claim", response_model=AdminReportView)
async def claim_report(
    report_id: uuid.UUID,
    user: User = Depends(get_admin_user),
    service: AdminService = Depends(_get_service),
) -> AdminReportView:
    try:
        return await service.claim_report(report_id, user.id)
    except AdminError as e:
        raise HTTPException(status_code=e.status_code, detail=e.code)


@router.post("/reports/{report_id}/resolve", response_model=AdminReportView)
async def resolve_report(
    report_id: uuid.UUID,
    body: ReportResolveRequest,
    user: User = Depends(get_admin_user),
    service: AdminService = Depends(_get_service),
) -> AdminReportView:
    try:
        return await service.resolve_report(report_id, user.id, body)
    except AdminError as e:
        raise HTTPException(status_code=e.status_code, detail=e.code)


@router.post("/users/{user_id}/suspend", response_model=AdminUserView)
async def suspend_user(
    user_id: uuid.UUID,
    body: UserActionRequest,
    user: User = Depends(get_admin_user),
    service: AdminService = Depends(_get_service),
) -> AdminUserView:
    try:
        return await service.suspend_user(user_id, user.id, body.reason)
    except AdminError as e:
        raise HTTPException(status_code=e.status_code, detail=e.code)


@router.post("/users/{user_id}/reinstate", response_model=AdminUserView)
async def reinstate_user(
    user_id: uuid.UUID,
    user: User = Depends(get_admin_user),
    service: AdminService = Depends(_get_service),
) -> AdminUserView:
    try:
        return await service.reinstate_user(user_id, user.id)
    except AdminError as e:
        raise HTTPException(status_code=e.status_code, detail=e.code)


@router.post("/books/{book_id}/takedown", status_code=204)
async def takedown_book(
    book_id: uuid.UUID,
    body: UserActionRequest,
    user: User = Depends(get_admin_user),
    service: AdminService = Depends(_get_service),
) -> None:
    try:
        await service.takedown_book(book_id, user.id, body.reason)
    except AdminError as e:
        raise HTTPException(status_code=e.status_code, detail=e.code)


@router.get("/blocked-places", response_model=BlockedPlaceListResponse)
async def list_blocked_places(
    user: User = Depends(get_admin_user),
    service: AdminService = Depends(_get_service),
) -> BlockedPlaceListResponse:
    return await service.list_blocked_places()


@router.post("/blocked-places", response_model=BlockedPlaceView, status_code=201)
async def create_blocked_place(
    body: BlockedPlaceCreateRequest,
    user: User = Depends(get_admin_user),
    service: AdminService = Depends(_get_service),
) -> BlockedPlaceView:
    return await service.create_blocked_place(user.id, body)


@router.delete("/blocked-places/{blocked_place_id}", status_code=204)
async def delete_blocked_place(
    blocked_place_id: uuid.UUID,
    user: User = Depends(get_admin_user),
    service: AdminService = Depends(_get_service),
) -> None:
    try:
        await service.delete_blocked_place(user.id, blocked_place_id)
    except AdminError as e:
        raise HTTPException(status_code=e.status_code, detail=e.code)


@router.get("/metrics", response_model=MetricsResponse)
async def get_metrics(
    user: User = Depends(get_admin_user),
    service: AdminService = Depends(_get_service),
) -> MetricsResponse:
    return await service.get_metrics()
