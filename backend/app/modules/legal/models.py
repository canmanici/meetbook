"""KVKK data-subject requests (Madde 11 başvuruları).

The law gives the controller 30 days to answer, so every request is persisted
(it used to be only logged, i.e. effectively lost) and tracked to closure.
"""

import uuid
from datetime import UTC, datetime

from sqlalchemy import Column, DateTime, ForeignKey, Index, String, Text
from sqlalchemy.dialects.postgresql import UUID

from app.core.db import Base


class DataSubjectRequestRecord(Base):
    __tablename__ = "data_subject_requests"
    __table_args__ = (Index("ix_data_subject_requests_status", "status"),)

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid7)
    reference = Column(String(12), nullable=False, unique=True)
    full_name = Column(String(200), nullable=False)
    email = Column(String(320), nullable=False)
    phone = Column(String(20), nullable=True)
    username = Column(String(100), nullable=False)
    request_type = Column(String(100), nullable=False)
    description = Column(Text, nullable=False)
    extra_info = Column(Text, nullable=True)
    identity_method = Column(String(100), nullable=False)
    # open → in_progress → answered | rejected
    status = Column(String(20), nullable=False, default="open")
    admin_notes = Column(Text, nullable=True)
    handled_by = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(UTC))
    due_at = Column(DateTime(timezone=True), nullable=False)
    closed_at = Column(DateTime(timezone=True), nullable=True)
