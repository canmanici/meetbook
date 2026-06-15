"""SQLAlchemy models for the reports module."""

import enum
import uuid
from datetime import UTC, datetime

from sqlalchemy import Column, DateTime, Enum, ForeignKey, Index, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID

from app.core.db import Base


class ReportTarget(str, enum.Enum):
    user = "user"
    book = "book"
    message = "message"
    place = "place"


class ReportStatus(str, enum.Enum):
    open = "open"
    reviewing = "reviewing"
    resolved = "resolved"
    dismissed = "dismissed"


class Report(Base):
    __tablename__ = "reports"
    __table_args__ = (
        Index("ix_reports_status", "status"),
        Index("ix_reports_reporter_id", "reporter_id"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    reporter_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    target_type = Column(
        Enum(ReportTarget, name="report_target", create_type=True), nullable=False
    )
    target_id = Column(UUID(as_uuid=True), nullable=False)
    reason = Column(Text, nullable=False)
    content_snapshot = Column(JSONB, nullable=False, default=dict, server_default="{}")
    status = Column(
        Enum(ReportStatus, name="report_status", create_type=True),
        nullable=False,
        default=ReportStatus.open,
    )
    moderator_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    moderator_notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(UTC))
    updated_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(UTC))
    resolved_at = Column(DateTime(timezone=True), nullable=True)
