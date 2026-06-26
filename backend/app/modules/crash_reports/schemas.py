"""Pydantic schemas for crash report ingestion and admin views."""

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
