"""Crash report models — raw crashes + grouped crash fingerprints."""

import uuid
from datetime import UTC, datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class CrashReportGroup(Base):
    """Grouped crash fingerprint — same error_type + similar stack = one group.

    Each group aggregates 1..N raw CrashReport rows so admins triage by
    *root cause* instead of drowning in duplicates.
    """

    __tablename__ = "crash_report_groups"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid7
    )
    group_hash: Mapped[str] = mapped_column(
        String(64), unique=True, nullable=False, index=True,
        comment="SHA256(error_type + :: + normalized stack prefix)",
    )
    error_type: Mapped[str | None] = mapped_column(
        String(100), nullable=True, comment="Error.name e.g. TypeError"
    )
    error_message: Mapped[str | None] = mapped_column(
        Text, nullable=True, comment="Most common error message"
    )
    stack_trace: Mapped[str | None] = mapped_column(
        Text, nullable=True, comment="Latest full stack trace"
    )

    # Status workflow
    status: Mapped[str] = mapped_column(
        String(20), default="new", index=True,
        comment="new | investigating | fixed | closed",
    )
    severity: Mapped[str] = mapped_column(
        String(10), default="error", index=True,
        comment="fatal | error | warning",
    )

    # Counts
    occurrence_count: Mapped[int] = mapped_column(default=1, comment="Total times seen")
    affected_users: Mapped[int] = mapped_column(default=0, comment="Distinct affected user IDs")

    # Time
    first_seen: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )
    last_seen: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )

    # Version tracking
    first_seen_version: Mapped[str | None] = mapped_column(
        String(30), nullable=True, comment="App version when first seen"
    )
    fixed_in_version: Mapped[str | None] = mapped_column(
        String(30), nullable=True, comment="App version that fixed this"
    )
    affected_versions: Mapped[dict | None] = mapped_column(
        JSONB, nullable=True, default=dict, comment="{ version: count, ... }"
    )

    # Admin actions
    assignee_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        comment="Admin investigating this group",
    )
    notes: Mapped[str | None] = mapped_column(Text, nullable=True, comment="Admin notes")

    # Reference to a sample crash for quick detail view
    sample_crash_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("crash_reports.id", ondelete="SET NULL"),
        nullable=True,
        comment="Latest crash ID in this group (for breadcrumbs/device info)",
    )

    # Device stats (JSONB for flexibility)
    top_platforms: Mapped[dict | None] = mapped_column(
        JSONB, nullable=True, default=dict, comment="{ platform: count, ... }"
    )
    top_screens: Mapped[dict | None] = mapped_column(
        JSONB, nullable=True, default=dict, comment="{ screen: count, ... }"
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC), onupdate=lambda: datetime.now(UTC)
    )


class CrashReport(Base):
    """Raw crash report — one row per crash event."""

    __tablename__ = "crash_reports"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid7)
    group_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("crash_report_groups.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
        comment="FK to grouped crash fingerprint",
    )
    app: Mapped[str] = mapped_column(
        String(20), default="mobile", comment="mobile | backend | admin"
    )
    app_version: Mapped[str | None] = mapped_column(String(30), nullable=True, comment="e.g. 1.1.0")
    error_type: Mapped[str | None] = mapped_column(
        String(100), nullable=True, comment="Error.name e.g. TypeError"
    )
    error_message: Mapped[str] = mapped_column(Text, comment="Human-readable error description")
    stack_trace: Mapped[str | None] = mapped_column(
        Text, nullable=True, comment="Full JS/Python stack trace"
    )
    breadcrumbs: Mapped[list[dict]] = mapped_column(
        JSONB, default=list, comment="Last N user actions before crash"
    )
    device_info: Mapped[dict] = mapped_column(
        JSONB, default=dict, comment="{ platform, os_version, model, memory_mb, ... }"
    )
    screen_name: Mapped[str | None] = mapped_column(
        String(100), nullable=True, comment="Screen the user was on"
    )
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        comment="Logged-in user (if any)",
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        comment="When the crash was reported",
    )

    __table_args__ = (
        Index("ix_crash_reports_group_id", "group_id"),
    )
