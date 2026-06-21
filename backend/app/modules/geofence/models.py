"""SQLAlchemy models for the geofence module."""

import uuid
from datetime import UTC, datetime

from sqlalchemy import Column, DateTime, ForeignKey, Index, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import UUID

from app.core.db import Base


class GeofenceAlert(Base):
    __tablename__ = "geofence_alerts"
    __table_args__ = (
        UniqueConstraint("user_id", "wishlist_item_id", "book_id", name="uq_geofence_alert_idempotent"),
        Index("idx_geofence_alerts_user_unread", "user_id", postgresql_where=text("read_at IS NULL")),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    wishlist_item_id = Column(UUID(as_uuid=True), ForeignKey("wishlist_items.id", ondelete="CASCADE"), nullable=False)
    book_id = Column(UUID(as_uuid=True), ForeignKey("books.id", ondelete="CASCADE"), nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(UTC))
    read_at = Column(DateTime(timezone=True), nullable=True)
