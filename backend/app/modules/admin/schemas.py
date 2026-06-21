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


class TrustScoreRequest(BaseModel):
    # Null clears the override and reverts to the computed score.
    score: float | None = Field(default=None, ge=0, le=100)
    reason: str | None = Field(default=None, max_length=500)


class BroadcastRequest(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    message: str = Field(min_length=1, max_length=2000)


class BroadcastResponse(BaseModel):
    recipients: int


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


# -- User list/detail schemas ------------------------------------------------

class AdminUserListItem(BaseModel):
    id: uuid.UUID
    email: str
    name: str
    status: str
    is_admin: bool
    rating_average: float
    rating_count: int
    completed_exchanges: int
    created_at: datetime
    last_active_at: datetime | None


class AdminUserListResponse(BaseModel):
    items: list[AdminUserListItem]
    total: int


class AdminUserDetailView(BaseModel):
    id: uuid.UUID
    email: str
    name: str
    phone: str | None
    status: str
    is_admin: bool
    rating_average: float
    rating_count: int
    completed_exchanges: int
    created_at: datetime
    updated_at: datetime
    last_active_at: datetime | None
    email_verified_at: datetime | None
    phone_verified_at: datetime | None
    trusted_contact_name: str | None
    trusted_contact_phone: str | None
    loans_borrowed_count: int = 0
    loans_returned_on_time: int = 0
    loans_returned_late: int = 0
    trust_score_override: float | None = None
    trust_score: int = 0


# -- Book list/detail schemas ------------------------------------------------

class AdminBookListItem(BaseModel):
    id: uuid.UUID
    owner_id: uuid.UUID
    title: str
    author: str | None
    category: str
    condition: str
    is_available: bool
    view_count: int
    favorite_count: int
    created_at: datetime


class AdminBookListResponse(BaseModel):
    items: list[AdminBookListItem]
    total: int


class AdminBookDetailView(BaseModel):
    id: uuid.UUID
    owner_id: uuid.UUID
    title: str
    author: str | None
    isbn: str | None
    description: str | None
    category: str
    language: str
    condition: str
    is_available: bool
    view_count: int
    favorite_count: int
    created_at: datetime
    updated_at: datetime
    deleted_at: datetime | None


# -- Exchange list/detail schemas --------------------------------------------

class AdminExchangeListItem(BaseModel):
    id: uuid.UUID
    book_id: uuid.UUID
    requested_by: uuid.UUID
    requested_to: uuid.UUID
    status: str
    created_at: datetime
    updated_at: datetime
    expires_at: datetime


class AdminExchangeListResponse(BaseModel):
    items: list[AdminExchangeListItem]
    total: int


class AdminExchangeDetailView(BaseModel):
    id: uuid.UUID
    book_id: uuid.UUID
    requested_by: uuid.UUID
    requested_to: uuid.UUID
    status: str
    initial_message: str
    completion_marked_by: uuid.UUID | None
    created_at: datetime
    updated_at: datetime
    expires_at: datetime


# -- Audit log schemas -------------------------------------------------------

class AuditLogEntry(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID | None
    event_type: str
    ip_address: str | None
    user_agent: str | None
    metadata_: dict | None
    created_at: datetime


class AuditLogListResponse(BaseModel):
    items: list[AuditLogEntry]
    total: int
