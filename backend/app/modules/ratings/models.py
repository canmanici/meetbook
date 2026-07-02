"""SQLAlchemy models for the ratings module."""

import uuid
from datetime import UTC, datetime

from sqlalchemy import (
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID

from app.core.db import Base

# Double-blind: a rating is hidden (revealed_at is null) until both participants
# have rated the exchange, or the reveal worker times it out after 14 days.
REVEAL_TIMEOUT_DAYS = 14


class Rating(Base):
    __tablename__ = "ratings"
    __table_args__ = (
        UniqueConstraint("exchange_request_id", "rated_by", name="uq_ratings_exchange_rater"),
        CheckConstraint("score >= 1 AND score <= 5", name="ck_ratings_score_range"),
        Index("ix_ratings_rated_user", "rated_user"),
        Index("ix_ratings_exchange_request_id", "exchange_request_id"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid7)
    exchange_request_id = Column(
        UUID(as_uuid=True), ForeignKey("exchange_requests.id", ondelete="CASCADE"), nullable=False
    )
    rated_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    rated_user = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    score = Column(Integer, nullable=False)
    comment = Column(Text, nullable=True)
    revealed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(UTC))
