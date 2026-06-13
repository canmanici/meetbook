"""SQLAlchemy models for the wishlist module."""

import uuid
from datetime import UTC, datetime

from sqlalchemy import Column, DateTime, ForeignKey, Index, Text
from sqlalchemy.dialects.postgresql import UUID

from app.core.db import Base


class WishlistItem(Base):
    __tablename__ = "wishlist_items"
    __table_args__ = (
        Index("ix_wishlist_items_user_id", "user_id"),
        Index("ix_wishlist_items_isbn", "isbn"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    isbn = Column(Text, nullable=False)
    title = Column(Text, nullable=True)
    author = Column(Text, nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(UTC))
