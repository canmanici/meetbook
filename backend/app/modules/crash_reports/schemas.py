"""Pydantic schemas for crash report ingestion, admin views, and grouped crashes."""

import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class BreadcrumbEntry(BaseModel):
    """A single user action recorded before the crash."""
    action: str  # e.g. "navigate", "api_call", "tap_button"
    label: str   # e.g. "Navigated to /book/123", "GET /auth/me"
    timestamp: str  # ISO 8601
    data: dict | None = None  # optional extra context


class DeviceInfo(BaseModel):
    """Device metadata sent with every crash."""
    platform: str  # "android" | "ios"
    os_version: str
    model: str | None = None
    app_version: str | None = None
    memory_mb: int | None = None
    is_emulator: bool = False


class CrashReportCreate(BaseModel):
    """Payload sent by the mobile app or backend crash handler."""
    app: str = "mobile"
    app_version: str | None = None
    error_type: str | None = None
    error_message: str = Field(..., max_length=5000)
    stack_trace: str | None = Field(None, max_length=20000)
    breadcrumbs: list[BreadcrumbEntry] = Field(default_factory=list, max_length=50)
    device_info: DeviceInfo | None = None
    screen_name: str | None = Field(None, max_length=200)
    user_id: str | None = None  # string because it comes from Expo SecureStore


class CrashReportView(BaseModel):
    """Single crash report returned to admin dashboard."""
    id: uuid.UUID
    group_id: uuid.UUID | None = None
    app: str
    app_version: str | None
    error_type: str | None
    error_message: str
    stack_trace: str | None
    breadcrumbs: list[dict]
    device_info: dict
    screen_name: str | None
    user_id: uuid.UUID | None
    created_at: datetime

    model_config = {"from_attributes": True}


class CrashReportListResponse(BaseModel):
    """Paginated list of crash reports."""
    items: list[CrashReportView]
    total: int
    page: int
    page_size: int


# ─── Grouped Crash Reports ────────────────────────────────────────────────────


class CrashReportGroupView(BaseModel):
    """Grouped crash fingerprint for admin triage."""
    id: uuid.UUID
    group_hash: str
    error_type: str | None
    error_message: str | None
    stack_trace: str | None
    status: str
    severity: str
    occurrence_count: int
    affected_users: int
    first_seen: datetime
    last_seen: datetime
    first_seen_version: str | None
    fixed_in_version: str | None
    affected_versions: dict | None
    assignee_id: uuid.UUID | None
    notes: str | None
    sample_crash_id: uuid.UUID | None
    top_platforms: dict | None
    top_screens: dict | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class CrashReportGroupListResponse(BaseModel):
    """Paginated list of grouped crash fingerprints."""
    items: list[CrashReportGroupView]
    total: int
    page: int
    page_size: int


class CrashReportGroupActionRequest(BaseModel):
    """Admin action on a crash group: change status, assign, add notes."""
    action: str = Field(..., description="investigate | fix | close | reopen | assign | notes")
    value: str | None = Field(default=None, max_length=2000)
    """For assign: user_id as string. For notes/fix/close: text. For investigate: ignored."""


class CrashReportTrendPoint(BaseModel):
    """Crash frequency at a point in time."""
    date: str  # YYYY-MM-DD
    total: int
    fatal: int
    error: int
    warning: int


class CrashReportTrendResponse(BaseModel):
    """Crash frequency over time."""
    items: list[CrashReportTrendPoint]


class CrashReportVersionStats(BaseModel):
    """Crash counts per app version."""
    version: str
    count: int
    distinct_errors: int
    last_seen: datetime


class CrashReportVersionStatsResponse(BaseModel):
    items: list[CrashReportVersionStats]
