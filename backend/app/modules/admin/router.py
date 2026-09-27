"""Admin moderation endpoints — role-gated via `get_admin_user`."""

import uuid
from collections.abc import Awaitable, Callable
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_session
from app.core.redis import get_cached, set_cached
from app.modules.admin.metrics_service import MetricsService
from app.modules.admin.schemas import (
    AdminBookDetailView,
    AdminBookListResponse,
    AdminExchangeDetailView,
    AdminExchangeListResponse,
    AdminReportListResponse,
    AdminReportView,
    AdminUserDetailView,
    AdminUserListResponse,
    AdminUserView,
    AuditLogListResponse,
    BadgeResponse,
    BlockedPlaceCreateRequest,
    BlockedPlaceListResponse,
    BlockedPlaceView,
    BookMetricsResponse,
    BroadcastRequest,
    BroadcastResponse,
    ExchangeMetricsResponse,
    MetricsOverviewResponse,
    MetricsResponse,
    ReportResolveRequest,
    SystemHealthResponse,
    TrendGroup,
    TrustMetricsResponse,
    TrustScoreRequest,
    UserActionRequest,
    UserMetricsResponse,
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


@router.get("/reports/{report_id}", response_model=AdminReportView)
async def get_report(
    report_id: uuid.UUID,
    user: User = Depends(get_admin_user),
    service: AdminService = Depends(_get_service),
) -> AdminReportView:
    try:
        return await service.get_report(report_id)
    except AdminError as e:
        raise HTTPException(status_code=e.status_code, detail=e.code)


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


# ══════════════════════════════════════════════════════════════════════════════
# OCEAN METRICS ENDPOINTS — CEO Dashboard
# ══════════════════════════════════════════════════════════════════════════════


def _get_metrics_service(session: AsyncSession = Depends(get_session)) -> MetricsService:
    return MetricsService(session)


# The dashboard auto-refreshes every 60 s per open tab and the overview alone
# is ~23 aggregate queries — serve all admins from a short Redis cache.
METRICS_CACHE_TTL_SECONDS = 30


async def _cached_metrics[M: BaseModel](
    key: str, model: type[M], produce: Callable[[], Awaitable[M]]
) -> M:
    raw = await get_cached(f"admin:metrics:{key}")
    if raw is not None:
        try:
            return model.model_validate_json(raw)
        except ValueError:
            pass  # schema changed since it was cached — recompute
    result = await produce()
    await set_cached(
        f"admin:metrics:{key}", result.model_dump(mode="json"), METRICS_CACHE_TTL_SECONDS
    )
    return result


@router.get("/metrics/overview", response_model=MetricsOverviewResponse)
async def get_metrics_overview(
    user: User = Depends(get_admin_user),
    ms: MetricsService = Depends(_get_metrics_service),
) -> MetricsOverviewResponse:
    """Ocean overview: 50+ KPIs across users, books, exchanges, reports, engagement, trust, system."""
    return await _cached_metrics("overview", MetricsOverviewResponse, ms.get_overview)


@router.get("/metrics/trends", response_model=TrendGroup)
async def get_metrics_trends(
    days: int = Query(default=30, ge=7, le=90),
    user: User = Depends(get_admin_user),
    ms: MetricsService = Depends(_get_metrics_service),
) -> TrendGroup:
    """Time-series data: signups, DAU, exchanges, reports, books, favorites per day."""
    return await _cached_metrics(f"trends:{days}", TrendGroup, lambda: ms.get_trends(days))


@router.get("/metrics/books", response_model=BookMetricsResponse)
async def get_metrics_books(
    user: User = Depends(get_admin_user),
    ms: MetricsService = Depends(_get_metrics_service),
) -> BookMetricsResponse:
    """Book inventory analytics: category/condition/language distribution, top books."""
    return await _cached_metrics("books", BookMetricsResponse, ms.get_book_metrics)


@router.get("/metrics/exchanges", response_model=ExchangeMetricsResponse)
async def get_metrics_exchanges(
    user: User = Depends(get_admin_user),
    ms: MetricsService = Depends(_get_metrics_service),
) -> ExchangeMetricsResponse:
    """Exchange analytics: success rate, completion time, pipeline, top exchangers."""
    return await _cached_metrics("exchanges", ExchangeMetricsResponse, ms.get_exchange_metrics)


@router.get("/metrics/users", response_model=UserMetricsResponse)
async def get_metrics_users(
    user: User = Depends(get_admin_user),
    ms: MetricsService = Depends(_get_metrics_service),
) -> UserMetricsResponse:
    """User analytics: status breakdown, verification rates, engagement."""
    return await _cached_metrics("users", UserMetricsResponse, ms.get_user_metrics)


@router.get("/metrics/trust", response_model=TrustMetricsResponse)
async def get_metrics_trust(
    user: User = Depends(get_admin_user),
    ms: MetricsService = Depends(_get_metrics_service),
) -> TrustMetricsResponse:
    """Trust & safety: bans, suspensions, report resolution, top offenders, recent actions."""
    return await _cached_metrics("trust", TrustMetricsResponse, ms.get_trust_metrics)


@router.get("/metrics/system", response_model=SystemHealthResponse)
async def get_metrics_system(
    user: User = Depends(get_admin_user),
    ms: MetricsService = Depends(_get_metrics_service),
) -> SystemHealthResponse:
    """System health: DB size, connections, cache hit ratio, crash reports."""
    return await ms.get_system_health()


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


@router.get("/search")
async def admin_search(
    q: str = Query(default=""),
    user: User = Depends(get_admin_user),
    service: AdminService = Depends(_get_service),
) -> dict[str, Any]:
    """Global admin search across users, books, and exchanges."""
    return await service.global_search(q)


@router.get("/badges", response_model=BadgeResponse)
async def get_badges(
    user: User = Depends(get_admin_user),
    service: AdminService = Depends(_get_service),
) -> dict[str, Any]:
    """Badge counts for navbar polling — new crashes, open reports, recent audit."""
    return await service.get_badges()


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
