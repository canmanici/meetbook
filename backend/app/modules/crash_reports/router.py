"""Crash report endpoints — ingest (public) + admin list/detail."""

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_session
from app.modules.admin.router import router as admin_router
from app.modules.crash_reports.models import CrashReport
from app.modules.crash_reports.schemas import (
    CrashReportCreate,
    CrashReportView,
    CrashReportListResponse,
)
from app.modules.auth.dependencies import get_admin_user
from app.modules.auth.models import User

# ── Public router (no auth — crash can happen logged out) ──────────
crash_router = APIRouter(prefix="/crash-report", tags=["crash"])


@crash_router.post("", status_code=201)
async def report_crash(
    payload: CrashReportCreate,
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Ingest a crash report from mobile app or backend.

    No authentication required — the app may crash during login or
    before the user is authenticated.
    """
    crash = CrashReport(
        app=payload.app,
        app_version=payload.app_version,
        error_type=payload.error_type,
        error_message=payload.error_message,
        stack_trace=payload.stack_trace,
        breadcrumbs=[b.model_dump() for b in payload.breadcrumbs],
        device_info=payload.device_info.model_dump() if payload.device_info else {},
        screen_name=payload.screen_name,
        user_id=uuid.UUID(payload.user_id) if payload.user_id else None,
    )
    session.add(crash)
    await session.commit()
    return {"id": str(crash.id), "ok": True}


# ── Admin endpoints (auth required, attached to existing admin router) ──────────

@admin_router.get("/crash-reports", response_model=CrashReportListResponse)
async def list_crash_reports(
    app: str | None = Query(default=None, description="Filter by app: mobile/backend/admin"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    session: AsyncSession = Depends(get_session),
    admin_user: User = Depends(get_admin_user),
) -> CrashReportListResponse:
    """List crash reports (newest first). Admin only."""
    query = select(CrashReport)
    count_query = select(func.count(CrashReport.id))

    if app:
        query = query.where(CrashReport.app == app)
        count_query = count_query.where(CrashReport.app == app)

    total = (await session.execute(count_query)).scalar() or 0

    items = (
        await session.execute(
            query.order_by(desc(CrashReport.created_at))
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    ).scalars().all()

    return CrashReportListResponse(
        items=[CrashReportView.model_validate(r) for r in items],
        total=total,
        page=page,
        page_size=page_size,
    )


@admin_router.get("/crash-reports/{crash_id}", response_model=CrashReportView)
async def get_crash_report(
    crash_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    admin_user: User = Depends(get_admin_user),
) -> CrashReportView:
    """Get a single crash report with full stack trace. Admin only."""
    result = await session.execute(
        select(CrashReport).where(CrashReport.id == crash_id)
    )
    crash = result.scalar_one_or_none()
    if not crash:
        raise HTTPException(status_code=404, detail="Crash report not found")
    return CrashReportView.model_validate(crash)
