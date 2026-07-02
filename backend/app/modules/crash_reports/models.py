"""Crash report model — stores app crashes for debugging."""

import uuid
from datetime import UTC, datetime

from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class CrashReport(Base):
    __tablename__ = "crash_reports"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid7)
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
