"""Crash report endpoints — ingest (public) + admin grouped management."""

import hashlib
import re
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, desc, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_session
from app.modules.admin.router import router as admin_router
from app.modules.auth.dependencies import get_admin_user
from app.modules.auth.models import User
from app.modules.crash_reports.models import CrashReport, CrashReportGroup
from app.modules.crash_reports.schemas import (
    CrashReportCreate,
    CrashReportGroupActionRequest,
    CrashReportGroupListResponse,
    CrashReportGroupView,
    CrashReportListResponse,
    CrashReportTrendPoint,
    CrashReportTrendResponse,
    CrashReportVersionStats,
    CrashReportVersionStatsResponse,
    CrashReportView,
)

# ── Public router (no auth — crash can happen logged out) ──────────
crash_router = APIRouter(prefix="/crash-report", tags=["crash"])

# ── Helpers ───────────────────────────────────────────────────────────────────


def _normalize_stack_frame(frame: str) -> str:
    """Strip file paths, line numbers, and memory addresses from a stack frame.

    '    at Foo.bar (/app/packages/mobile/src/screens/Home.tsx:42:12)'
      → 'at Foo.bar'

    '  File "/app/backend/app/modules/foo.py", line 42, in do_stuff'
      → 'File do_stuff'
    """
    frame = frame.strip()
    # JS/TS style: "at FunctionName (/path/to/file.ts:line:col)"
    js_match = re.match(r"(at\s+\S+)", frame)
    if js_match:
        return js_match.group(1).rstrip(",")
    # Python style: 'File "/path/to/file.py", line N, in func_name'
    py_match = re.match(r'File\s+".*?",\s*line\s+\d+,\s*in\s+(\S+)', frame)
    if py_match:
        return f"in {py_match.group(1)}"
    return frame


def _compute_group_hash(error_type: str | None, stack_trace: str | None) -> str:
    """Compute a stable hash for crash grouping.

    Hash ingredients:
      1. error_type (or 'Unknown')
      2. First 3 normalized stack frames (or 'no_stack')

    This means similar crashes (same error, same call path) land
    in the same group regardless of line numbers or memory addresses.
    """
    et = (error_type or "Unknown").strip()

    frames = []
    if stack_trace:
        lines = stack_trace.split("\n")
        for line in lines:
            normalized = _normalize_stack_frame(line)
            if normalized:
                frames.append(normalized)
                if len(frames) >= 3:
                    break

    stack_key = " | ".join(frames) if frames else "no_stack"
    raw = f"{et}::{stack_key}"
    return hashlib.sha256(raw.encode()).hexdigest()


def _infer_severity(error_type: str | None, error_message: str | None) -> str:
    """Heuristic severity: fatal if unhandled, error otherwise."""
    if error_type and "Fatal" in error_type:
        return "fatal"
    if error_type and ("Warning" in error_type or "warn" in (error_message or "").lower()):
        return "warning"
    return "error"


async def _find_or_create_group(
    session: AsyncSession,
    payload: CrashReportCreate,
    crash_id: uuid.UUID,
) -> CrashReportGroup:
    """Find existing group by hash or create a new one, update counters."""
    group_hash = _compute_group_hash(payload.error_type, payload.stack_trace)
    severity = _infer_severity(payload.error_type, payload.error_message)
    platform = payload.device_info.platform if payload.device_info else "unknown"
    screen = payload.screen_name or "unknown"
    version = payload.app_version or "unknown"

    # Find existing group
    result = await session.execute(
        select(CrashReportGroup).where(CrashReportGroup.group_hash == group_hash)
    )
    group = result.scalar_one_or_none()

    if group:
        # Update counters
        group.occurrence_count = (group.occurrence_count or 0) + 1
        group.last_seen = datetime.now(UTC)
        group.stack_trace = payload.stack_trace or group.stack_trace
        group.error_message = payload.error_message or group.error_message
        group.sample_crash_id = crash_id

        # Update version stats
        versions = group.affected_versions or {}
        versions[version] = versions.get(version, 0) + 1
        group.affected_versions = versions

        # Update platform stats
        platforms = group.top_platforms or {}
        platforms[platform] = platforms.get(platform, 0) + 1
        group.top_platforms = platforms

        # Update screen stats
        screens = group.top_screens or {}
        screens[screen] = screens.get(screen, 0) + 1
        group.top_screens = screens

        # Update affected users count if user_id present
        # (We don't track WHO, just how many distinct — approximate)
        if payload.user_id:
            group.affected_users = (group.affected_users or 0) + 1

        group.updated_at = datetime.now(UTC)
    else:
        platforms = {platform: 1} if platform != "unknown" else {}
        screens = {screen: 1} if screen != "unknown" else {}
        versions_dict = {version: 1} if version != "unknown" else {}

        group = CrashReportGroup(
            group_hash=group_hash,
            error_type=payload.error_type,
            error_message=payload.error_message,
            stack_trace=payload.stack_trace,
            status="new",
            severity=severity,
            occurrence_count=1,
            affected_users=1 if payload.user_id else 0,
            first_seen=datetime.now(UTC),
            last_seen=datetime.now(UTC),
            first_seen_version=payload.app_version,
            affected_versions=versions_dict,
            sample_crash_id=crash_id,
            top_platforms=platforms,
            top_screens=screens,
        )
        session.add(group)

    await session.flush()
    return group


def _parse_uuid(value: str | None) -> uuid.UUID | None:
    """Unauthenticated input — a malformed id must not turn into a 500."""
    try:
        return uuid.UUID(value) if value else None
    except ValueError, TypeError, AttributeError:
        return None


# ── Ingest endpoint (public) ──────────────────────────────────────────────────


@crash_router.post("", status_code=201)
async def report_crash(
    payload: CrashReportCreate,
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    """Ingest a crash report from mobile app or backend.

    No authentication required — the app may crash during login or
    before the user is authenticated.

    Auto-groups the crash by error type + normalized stack trace.
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
        user_id=_parse_uuid(payload.user_id),
    )
    session.add(crash)
    await session.flush()  # get crash.id

    # Group the crash
    group = await _find_or_create_group(session, payload, crash.id)
    crash.group_id = group.id

    await session.commit()
    return {"id": str(crash.id), "group_id": str(group.id), "ok": True}


# ── Admin endpoints (auth required, attached to existing admin router) ──────────


@admin_router.get("/crash-reports", response_model=CrashReportListResponse)
async def list_crash_reports(
    group_id: uuid.UUID | None = Query(default=None, description="Filter by group"),
    app: str | None = Query(default=None, description="Filter by app: mobile/backend/admin"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    session: AsyncSession = Depends(get_session),
    admin_user: User = Depends(get_admin_user),
) -> CrashReportListResponse:
    """List individual crash reports (newest first). Admin only."""
    query = select(CrashReport)
    count_query = select(func.count(CrashReport.id))

    if app:
        query = query.where(CrashReport.app == app)
        count_query = count_query.where(CrashReport.app == app)
    if group_id:
        query = query.where(CrashReport.group_id == group_id)
        count_query = count_query.where(CrashReport.group_id == group_id)

    total = (await session.execute(count_query)).scalar() or 0

    items = (
        (
            await session.execute(
                query.order_by(desc(CrashReport.created_at))
                .offset((page - 1) * page_size)
                .limit(page_size)
            )
        )
        .scalars()
        .all()
    )

    return CrashReportListResponse(
        items=[CrashReportView.model_validate(r) for r in items],
        total=total,
        page=page,
        page_size=page_size,
    )


# ── Grouped crash endpoints (must be BEFORE {crash_id} to avoid UUID match) ──────────────────


@admin_router.get("/crash-reports/groups", response_model=CrashReportGroupListResponse)
async def list_crash_groups(
    status: str | None = Query(default=None, description="Filter: new|investigating|fixed|closed"),
    severity: str | None = Query(default=None, description="Filter: fatal|error|warning"),
    app: str | None = Query(default=None, description="Filter by app"),
    search: str | None = Query(default=None, description="Search error_type or message"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    session: AsyncSession = Depends(get_session),
    admin_user: User = Depends(get_admin_user),
) -> CrashReportGroupListResponse:
    """List grouped crash fingerprints (most recent first). Admin only."""
    query = select(CrashReportGroup)
    count_query = select(func.count(CrashReportGroup.id))

    if status:
        query = query.where(CrashReportGroup.status == status)
        count_query = count_query.where(CrashReportGroup.status == status)
    if severity:
        query = query.where(CrashReportGroup.severity == severity)
        count_query = count_query.where(CrashReportGroup.severity == severity)
    if search:
        like = f"%{search}%"
        query = query.where(
            and_(
                CrashReportGroup.error_type.ilike(like),
                CrashReportGroup.error_message.ilike(like),
            )
        )
        count_query = count_query.where(
            and_(
                CrashReportGroup.error_type.ilike(like),
                CrashReportGroup.error_message.ilike(like),
            )
        )
    if app:
        # Filter groups that have crashes from this app
        subq = select(CrashReport.group_id).where(CrashReport.app == app).distinct()
        query = query.where(CrashReportGroup.id.in_(subq))
        count_query = count_query.where(CrashReportGroup.id.in_(subq))

    total = (await session.execute(count_query)).scalar() or 0

    items = (
        (
            await session.execute(
                query.order_by(desc(CrashReportGroup.last_seen))
                .offset((page - 1) * page_size)
                .limit(page_size)
            )
        )
        .scalars()
        .all()
    )

    return CrashReportGroupListResponse(
        items=[CrashReportGroupView.model_validate(g) for g in items],
        total=total,
        page=page,
        page_size=page_size,
    )


@admin_router.get("/crash-reports/groups/{group_id}", response_model=CrashReportGroupView)
async def get_crash_group(
    group_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    admin_user: User = Depends(get_admin_user),
) -> CrashReportGroupView:
    """Get a single crash group with detail info. Admin only."""
    result = await session.execute(select(CrashReportGroup).where(CrashReportGroup.id == group_id))
    group = result.scalar_one_or_none()
    if not group:
        raise HTTPException(status_code=404, detail="Crash group not found")
    return CrashReportGroupView.model_validate(group)


@admin_router.post("/crash-reports/groups/{group_id}/action")
async def action_crash_group(
    group_id: uuid.UUID,
    action_req: CrashReportGroupActionRequest,
    session: AsyncSession = Depends(get_session),
    admin_user: User = Depends(get_admin_user),
) -> dict[str, Any]:
    """Perform an action on a crash group. Admin only.

    Actions:
      - investigate : set status → 'investigating'
      - fix         : set status → 'fixed', optionally store fixed_in_version
      - close       : set status → 'closed'
      - reopen      : set status → 'new'
      - assign      : set assignee_id
      - notes       : update notes text
    """
    result = await session.execute(select(CrashReportGroup).where(CrashReportGroup.id == group_id))
    group = result.scalar_one_or_none()
    if not group:
        raise HTTPException(status_code=404, detail="Crash group not found")

    action = action_req.action
    value = action_req.value

    if action == "investigate":
        group.status = "investigating"
    elif action == "fix":
        group.status = "fixed"
        if value:
            group.fixed_in_version = value
    elif action == "close":
        group.status = "closed"
    elif action == "reopen":
        group.status = "new"
        group.fixed_in_version = None
    elif action == "assign":
        try:
            group.assignee_id = uuid.UUID(value) if value else None
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid user ID format")
    elif action == "notes":
        group.notes = value
    else:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown action: {action}. Use: investigate, fix, close, reopen, assign, notes",
        )

    group.updated_at = datetime.now(UTC)
    await session.commit()

    return {"id": str(group.id), "status": group.status, "ok": True}


# ── Crash trends ──────────────────────────────────────────────────────────────


@admin_router.get("/crash-reports/trends", response_model=CrashReportTrendResponse)
async def crash_trends(
    days: int = Query(default=30, ge=1, le=365),
    session: AsyncSession = Depends(get_session),
    admin_user: User = Depends(get_admin_user),
) -> CrashReportTrendResponse:
    """Crash frequency over time, broken down by severity. Admin only."""
    cutoff = datetime.now(UTC) - timedelta(days=days)
    rows = (
        await session.execute(
            text("""
                SELECT
                    DATE(created_at) AS d,
                    COUNT(*) AS total,
                    COUNT(*) FILTER (WHERE error_type ILIKE '%fatal%' OR error_type ILIKE '%unhandled%') AS fatal,
                    COUNT(*) FILTER (WHERE error_type NOT ILIKE '%fatal%' AND error_type NOT ILIKE '%unhandled%' AND (error_type NOT ILIKE '%warn%' AND COALESCE(error_message, '') NOT ILIKE '%warn%')) AS error,
                    COUNT(*) FILTER (WHERE error_type ILIKE '%warn%' OR COALESCE(error_message, '') ILIKE '%warn%') AS warning
                FROM crash_reports
                WHERE created_at >= :cutoff
                GROUP BY d
                ORDER BY d
            """),
            {"cutoff": cutoff},
        )
    ).all()

    return CrashReportTrendResponse(
        items=[
            CrashReportTrendPoint(
                date=str(r.d),
                total=r.total,
                fatal=r.fatal,
                error=r.error,
                warning=r.warning,
            )
            for r in rows
        ]
    )


# ── Version stats ─────────────────────────────────────────────────────────────


@admin_router.get("/crash-reports/versions", response_model=CrashReportVersionStatsResponse)
async def crash_version_stats(
    session: AsyncSession = Depends(get_session),
    admin_user: User = Depends(get_admin_user),
) -> CrashReportVersionStatsResponse:
    """Crash counts grouped by app version. Admin only."""
    rows = (
        await session.execute(
            text("""
                SELECT
                    COALESCE(app_version, 'unknown') AS version,
                    COUNT(*) AS count,
                    COUNT(DISTINCT error_type) AS distinct_errors,
                    MAX(created_at) AS last_seen
                FROM crash_reports
                GROUP BY version
                ORDER BY count DESC
            """)
        )
    ).all()

    return CrashReportVersionStatsResponse(
        items=[
            CrashReportVersionStats(
                version=r.version,
                count=r.count,
                distinct_errors=r.distinct_errors,
                last_seen=r.last_seen,
            )
            for r in rows
        ]
    )


@admin_router.get("/crash-reports/{crash_id}", response_model=CrashReportView)
async def get_crash_report(
    crash_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    admin_user: User = Depends(get_admin_user),
) -> CrashReportView:
    """Get a single crash report with full stack trace. Admin only."""
    result = await session.execute(select(CrashReport).where(CrashReport.id == crash_id))
    crash = result.scalar_one_or_none()
    if not crash:
        raise HTTPException(status_code=404, detail="Crash report not found")
    return CrashReportView.model_validate(crash)
