"""Pydantic schemas for the admin module."""

import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.modules.reports.models import ReportStatus, ReportTarget


class AdminReportView(BaseModel):
    id: uuid.UUID
    reporter_id: uuid.UUID
    target_type: ReportTarget
    target_id: uuid.UUID
    reason: str
    content_snapshot: dict
    status: ReportStatus
    moderator_id: uuid.UUID | None
    moderator_notes: str | None
    created_at: datetime
    updated_at: datetime
    resolved_at: datetime | None


class AdminReportListResponse(BaseModel):
    items: list[AdminReportView]


class ReportResolveRequest(BaseModel):
    status: ReportStatus
    moderator_notes: str | None = Field(default=None, max_length=2000)


class UserActionRequest(BaseModel):
    reason: str | None = Field(default=None, max_length=500)


class AdminUserView(BaseModel):
    id: uuid.UUID
    email: str
    name: str
    status: str
    rating_average: float
    rating_count: int
    completed_exchanges: int
    created_at: datetime


class BlockedPlaceCreateRequest(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    place_id: str | None = None
    reason: str | None = Field(default=None, max_length=500)


class BlockedPlaceView(BaseModel):
    id: uuid.UUID
    place_id: str | None
    lat: float
    lng: float
    reason: str | None
    created_at: datetime


class BlockedPlaceListResponse(BaseModel):
    items: list[BlockedPlaceView]


class MetricsResponse(BaseModel):
    daily_active_users: int
    total_users: int
    exchanges_by_status: dict[str, int]
    reports_by_reason: dict[str, int]
    open_reports: int
