"""Admin moderation endpoints — role-gated via `get_admin_user`."""

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_session
from app.modules.admin.schemas import (
    AdminBookListResponse,
    AdminBookDetailView,
    AdminExchangeListResponse,
    AdminExchangeDetailView,
    AdminReportListResponse,
    AdminReportView,
    AdminUserListResponse,
    AdminUserDetailView,
    AdminUserView,
    AuditLogListResponse,
    BlockedPlaceCreateRequest,
    BlockedPlaceListResponse,
    BlockedPlaceView,
    BroadcastRequest,
    BroadcastResponse,
    MetricsResponse,
    ReportResolveRequest,
    TrustScoreRequest,
    UserActionRequest,
)
from app.modules.admin.service import AdminError, AdminService
from app.modules.auth.dependencies import get_admin_user
from app.modules.auth.models import User, UserStatus
from app.modules.exchanges.models import ExchangeStatus
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


@router.post("/users/{user_id}/ban", response_model=AdminUserView)
async def ban_user(
    user_id: uuid.UUID,
    body: UserActionRequest,
    user: User = Depends(get_admin_user),
    service: AdminService = Depends(_get_service),
) -> AdminUserView:
    try:
        return await service.ban_user(user_id, user.id, body.reason)
    except AdminError as e:
        raise HTTPException(status_code=e.status_code, detail=e.code)


@router.post("/users/{user_id}/unban", response_model=AdminUserView)
async def unban_user(
    user_id: uuid.UUID,
    user: User = Depends(get_admin_user),
    service: AdminService = Depends(_get_service),
) -> AdminUserView:
    try:
        return await service.unban_user(user_id, user.id)
    except AdminError as e:
        raise HTTPException(status_code=e.status_code, detail=e.code)


@router.post("/users/{user_id}/trust-score", response_model=AdminUserDetailView)
async def set_trust_score(
    user_id: uuid.UUID,
    body: TrustScoreRequest,
    user: User = Depends(get_admin_user),
    service: AdminService = Depends(_get_service),
) -> AdminUserDetailView:
    try:
        return await service.set_trust_score(user_id, user.id, body.score, body.reason)
    except AdminError as e:
        raise HTTPException(status_code=e.status_code, detail=e.code)


@router.post("/notifications/broadcast", response_model=BroadcastResponse)
async def broadcast_notification(
    body: BroadcastRequest,
    user: User = Depends(get_admin_user),
    service: AdminService = Depends(_get_service),
) -> BroadcastResponse:
    count = await service.broadcast_notification(user.id, body.title, body.message)
    return BroadcastResponse(recipients=count)


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


@router.get("/users", response_model=AdminUserListResponse)
async def list_users(
    search: str | None = Query(default=None),
    status: UserStatus | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    user: User = Depends(get_admin_user),
    service: AdminService = Depends(_get_service),
) -> AdminUserListResponse:
    return await service.list_users(search, status, limit, offset)


@router.get("/users/{user_id}", response_model=AdminUserDetailView)
async def get_user_detail(
    user_id: uuid.UUID,
    user: User = Depends(get_admin_user),
    service: AdminService = Depends(_get_service),
) -> AdminUserDetailView:
    try:
        return await service.get_user_detail(user_id)
    except AdminError as e:
        raise HTTPException(status_code=e.status_code, detail=e.code)


@router.get("/books", response_model=AdminBookListResponse)
async def list_books(
    search: str | None = Query(default=None),
    available_only: bool = Query(default=False),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    user: User = Depends(get_admin_user),
    service: AdminService = Depends(_get_service),
) -> AdminBookListResponse:
    return await service.list_books(search, available_only, limit, offset)


@router.get("/books/{book_id}", response_model=AdminBookDetailView)
async def get_book_detail(
    book_id: uuid.UUID,
    user: User = Depends(get_admin_user),
    service: AdminService = Depends(_get_service),
) -> AdminBookDetailView:
    try:
        return await service.get_book_detail(book_id)
    except AdminError as e:
        raise HTTPException(status_code=e.status_code, detail=e.code)


@router.get("/exchanges", response_model=AdminExchangeListResponse)
async def list_exchanges(
    status: ExchangeStatus | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    user: User = Depends(get_admin_user),
    service: AdminService = Depends(_get_service),
) -> AdminExchangeListResponse:
    return await service.list_exchanges(status, limit, offset)


@router.get("/exchanges/{exchange_id}", response_model=AdminExchangeDetailView)
async def get_exchange_detail(
    exchange_id: uuid.UUID,
    user: User = Depends(get_admin_user),
    service: AdminService = Depends(_get_service),
) -> AdminExchangeDetailView:
    try:
        return await service.get_exchange_detail(exchange_id)
    except AdminError as e:
        raise HTTPException(status_code=e.status_code, detail=e.code)


@router.get("/audit-log", response_model=AuditLogListResponse)
async def list_audit_logs(
    user_id: uuid.UUID | None = Query(default=None),
    event_type: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    user: User = Depends(get_admin_user),
    service: AdminService = Depends(_get_service),
) -> AuditLogListResponse:
    return await service.list_audit_logs(user_id, event_type, limit, offset)
