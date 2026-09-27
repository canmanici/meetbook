"""SQLAlchemy models for the books module."""

import enum
import uuid
from datetime import UTC, datetime
from typing import Any

from geoalchemy2 import Geography
from sqlalchemy import (
    Boolean,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class BookCategory(str, enum.Enum):
    fiction = "fiction"
    non_fiction = "non_fiction"
    textbook = "textbook"
    children = "children"
    comics = "comics"
    poetry = "poetry"
    other = "other"


class BookCondition(str, enum.Enum):
    new = "new"
    like_new = "like_new"
    good = "good"
    worn = "worn"


class Book(Base):
    __tablename__ = "books"
    __table_args__ = (
        Index("ix_books_owner_id", "owner_id"),
        Index("ix_books_location", "location", postgresql_using="gist"),
        Index("ix_books_public_location", "public_location", postgresql_using="gist"),
        Index("ix_books_isbn", "isbn", postgresql_where=text("isbn IS NOT NULL")),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid7)
    owner_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    title: Mapped[str] = mapped_column(Text, nullable=False)
    author: Mapped[str | None] = mapped_column(Text, nullable=True)
    isbn: Mapped[str | None] = mapped_column(Text, nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    category: Mapped[BookCategory] = mapped_column(
        Enum(BookCategory, name="book_category", create_type=True), nullable=False
    )
    language: Mapped[str] = mapped_column(Text, nullable=False, default="tr")
    condition: Mapped[BookCondition] = mapped_column(
        Enum(BookCondition, name="book_condition", create_type=True), nullable=False
    )
    is_available: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    location: Mapped[Any] = mapped_column(
        Geography(geometry_type="POINT", srid=4326, spatial_index=False), nullable=False
    )
    public_location: Mapped[Any] = mapped_column(
        Geography(geometry_type="POINT", srid=4326, spatial_index=False), nullable=False
    )
    view_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    favorite_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    sort_order: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default=text("0")
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(UTC)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(UTC)
    )


class BookFavorite(Base):
    __tablename__ = "book_favorites"
    __table_args__ = (
        UniqueConstraint("user_id", "book_id", name="uq_user_book_favorite"),
        Index("ix_book_favorites_book_id", "book_id"),
        Index("ix_book_favorites_user_id", "user_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid7)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    book_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("books.id", ondelete="CASCADE"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(UTC)
    )


class BookPhoto(Base):
    __tablename__ = "book_photos"
    __table_args__ = (Index("ix_book_photos_book_id", "book_id"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid7)
    book_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("books.id", ondelete="CASCADE"), nullable=False
    )
    url: Mapped[str] = mapped_column(Text, nullable=False)
    thumbnail_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(UTC)
    )
