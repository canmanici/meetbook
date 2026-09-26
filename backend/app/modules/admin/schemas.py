"""Pydantic schemas for the admin module."""

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field

from app.modules.reports.models import ReportStatus, ReportTarget


class AdminReportView(BaseModel):
    id: uuid.UUID
    reporter_id: uuid.UUID
    target_type: ReportTarget
    target_id: uuid.UUID
    reason: str
    content_snapshot: dict[str, Any]
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
    book_count: int = 0
    message_count: int = 0
    exchange_count: int = 0


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
    user_name: str | None  # joined from User table
    user_email: str | None  # joined from User table
    event_type: str
    ip_address: str | None
    user_agent: str | None
    metadata_: dict[str, Any] | None
    created_at: datetime


class AuditLogListResponse(BaseModel):
    items: list[AuditLogEntry]
    total: int


# ══════════════════════════════════════════════════════════════════════════════
# OCEAN METRICS — comprehensive dashboard data
# ══════════════════════════════════════════════════════════════════════════════


class TrendPoint(BaseModel):
    date: str  # YYYY-MM-DD
    value: int


# -- Overview (single call, everything) ---------------------------------------


class MetricsOverviewResponse(BaseModel):
    # Users
    total_users: int
    users_active: int
    users_suspended: int
    users_banned: int
    users_growth_30d: int
    users_growth_pct: float
    daily_active_users: int
    weekly_active_users: int
    monthly_active_users: int
    email_verified_count: int
    phone_verified_count: int
    admin_count: int

    # Books
    total_books: int
    books_available: int
    books_taken_down: int
    books_added_30d: int
    total_book_photos: int

    # Exchanges
    exchanges_by_status: dict[str, int]
    exchanges_total: int
    exchanges_30d: int
    exchanges_success_rate: float
    exchanges_avg_completion_hours: float | None

    # Reports
    open_reports: int
    reports_by_reason: dict[str, int]
    reports_resolved_30d: int
    reports_avg_resolution_hours: float | None

    # Engagement
    total_ratings: int
    avg_rating_score: float
    total_favorites: int
    total_book_views: int
    total_messages: int
    active_chats: int

    # Trust & Safety
    total_suspensions: int
    total_bans: int
    total_reinstatements: int
    blocked_places_count: int
    total_vouches: int

    # System
    total_crash_reports_30d: int
    generated_at: datetime


# -- Trends (time-series for charts) ------------------------------------------


class TrendGroup(BaseModel):
    signups: list[TrendPoint]
    daily_active_users: list[TrendPoint]
    weekly_active_users: list[TrendPoint]
    exchanges_created: list[TrendPoint]
    exchanges_completed: list[TrendPoint]
    reports_created: list[TrendPoint]
    books_added: list[TrendPoint]
    favorite_actions: list[TrendPoint]


# -- Book analytics -----------------------------------------------------------


class CategoryDistItem(BaseModel):
    category: str
    count: int
    pct: float


class TopBookItem(BaseModel):
    id: uuid.UUID
    title: str
    author: str | None
    owner_name: str
    count: int


class BookMetricsResponse(BaseModel):
    by_category: list[CategoryDistItem]
    by_condition: list[CategoryDistItem]
    by_language: list[CategoryDistItem]
    top_viewed: list[TopBookItem]
    top_favorited: list[TopBookItem]


# -- Exchange analytics -------------------------------------------------------


class TopExchangerItem(BaseModel):
    user_id: uuid.UUID
    name: str
    email: str
    count: int


class ExchangeMetricsResponse(BaseModel):
    by_status: dict[str, int]
    success_rate: float
    avg_completion_hours: float | None
    total_exchanges: int
    exchanges_this_month: int
    top_requesters: list[TopExchangerItem]
    top_owners: list[TopExchangerItem]


# -- User analytics -----------------------------------------------------------


class UserByStatusItem(BaseModel):
    status: str
    count: int
    pct: float


class UserMetricsResponse(BaseModel):
    by_status: list[UserByStatusItem]
    admin_count: int
    email_verified_pct: float
    phone_verified_pct: float
    avg_rating: float
    users_with_books: int
    users_with_exchanges: int


# -- Trust & Safety analytics -------------------------------------------------


class TopReportedUserItem(BaseModel):
    user_id: uuid.UUID
    name: str
    email: str
    report_count: int


class RecentActionItem(BaseModel):
    id: uuid.UUID
    moderator_name: str
    action: str
    target: str
    created_at: datetime


class TrustMetricsResponse(BaseModel):
    total_bans: int
    total_suspensions: int
    total_reinstatements: int
    reports_resolved_rate: float
    avg_resolution_hours: float | None
    open_reports_count: int
    top_reported_users: list[TopReportedUserItem]
    recent_mod_actions: list[RecentActionItem]


# -- System health ------------------------------------------------------------


class SystemHealthResponse(BaseModel):
    db_size_mb: float
    db_connections_active: int
    db_connections_total: int
    db_cache_hit_ratio: float | None
    crash_reports_30d: int
    crash_reports_total: int
    audit_log_total: int
    audit_log_30d: int


class BadgeResponse(BaseModel):
    new_crashes: int
    open_reports: int
    recent_audit: int
    total_crashes: int
