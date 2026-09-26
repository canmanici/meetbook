"""KVKK data-subject requests (Madde 11 başvuruları).

The law gives the controller 30 days to answer, so every request is persisted
(it used to be only logged, i.e. effectively lost) and tracked to closure.
"""

import uuid
from datetime import UTC, datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class DataSubjectRequestRecord(Base):
    __tablename__ = "data_subject_requests"
    __table_args__ = (Index("ix_data_subject_requests_status", "status"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid7)
    reference: Mapped[str] = mapped_column(String(12), nullable=False, unique=True)
    full_name: Mapped[str] = mapped_column(String(200), nullable=False)
    email: Mapped[str] = mapped_column(String(320), nullable=False)
    phone: Mapped[str | None] = mapped_column(String(20), nullable=True)
    username: Mapped[str] = mapped_column(String(100), nullable=False)
    request_type: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    extra_info: Mapped[str | None] = mapped_column(Text, nullable=True)
    identity_method: Mapped[str] = mapped_column(String(100), nullable=False)
    # open → in_progress → answered | rejected
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="open")
    admin_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    handled_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(UTC)
    )
    due_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
