"""SQLAlchemy models for the wishlist module."""

import uuid
from datetime import UTC, datetime

from sqlalchemy import Column, DateTime, ForeignKey, Index, String, Text
from sqlalchemy.dialects.postgresql import UUID

from app.core.db import Base


class WishlistItem(Base):
    __tablename__ = "wishlist_items"
    __table_args__ = (
        Index("ix_wishlist_items_user_id", "user_id"),
        Index("ix_wishlist_items_isbn", "isbn"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid7)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    isbn = Column(Text, nullable=False)
    title = Column(Text, nullable=True)
    author = Column(Text, nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(UTC))


class SharedWishlist(Base):
    __tablename__ = "shared_wishlists"
    __table_args__ = (Index("ix_shared_wishlists_owner_id", "owner_id"),)

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid7)
    name = Column(String(100), nullable=False)
    owner_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(UTC))


class SharedWishlistMember(Base):
    __tablename__ = "shared_wishlist_members"
    __table_args__ = (Index("ix_shared_wishlist_members_user_id", "user_id"),)

    wishlist_id = Column(
        UUID(as_uuid=True),
        ForeignKey("shared_wishlists.id", ondelete="CASCADE"),
        primary_key=True,
    )
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), primary_key=True)
    joined_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(UTC))


class SharedWishlistItem(Base):
    __tablename__ = "shared_wishlist_items"
    __table_args__ = (
        Index("ix_shared_wishlist_items_wishlist_id", "wishlist_id"),
        Index("ix_shared_wishlist_items_added_by", "added_by"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid7)
    wishlist_id = Column(
        UUID(as_uuid=True),
        ForeignKey("shared_wishlists.id", ondelete="CASCADE"),
        nullable=False,
    )
    added_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    isbn = Column(String(20), nullable=True)
    title = Column(String(200), nullable=False)
    author = Column(String(200), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(UTC))
