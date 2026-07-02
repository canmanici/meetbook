"""SQLAlchemy models for the books module."""

import enum
import uuid
from datetime import UTC, datetime

from geoalchemy2 import Geography
from sqlalchemy import (
    Boolean,
    Column,
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
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid7)
    owner_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    title = Column(Text, nullable=False)
    author = Column(Text, nullable=True)
    isbn = Column(Text, nullable=True)
    description = Column(Text, nullable=True)
    category = Column(Enum(BookCategory, name="book_category", create_type=True), nullable=False)
    language = Column(Text, nullable=False, default="tr")
    condition = Column(Enum(BookCondition, name="book_condition", create_type=True), nullable=False)
    is_available = Column(Boolean, nullable=False, default=True)
    location = Column(Geography(geometry_type="POINT", srid=4326), nullable=False)
    public_location = Column(Geography(geometry_type="POINT", srid=4326), nullable=False)
    view_count = Column(Integer, nullable=False, default=0)
    favorite_count = Column(Integer, nullable=False, default=0)
    sort_order = Column(Integer, nullable=False, default=0, server_default=text("0"))
    deleted_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(UTC))
    updated_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(UTC))


class BookFavorite(Base):
    __tablename__ = "book_favorites"
    __table_args__ = (
        UniqueConstraint("user_id", "book_id", name="uq_user_book_favorite"),
        Index("ix_book_favorites_book_id", "book_id"),
        Index("ix_book_favorites_user_id", "user_id"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid7)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    book_id = Column(UUID(as_uuid=True), ForeignKey("books.id", ondelete="CASCADE"), nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(UTC))


class BookPhoto(Base):
    __tablename__ = "book_photos"
    __table_args__ = (Index("ix_book_photos_book_id", "book_id"),)

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid7)
    book_id = Column(UUID(as_uuid=True), ForeignKey("books.id", ondelete="CASCADE"), nullable=False)
    url = Column(Text, nullable=False)
    thumbnail_url = Column(Text, nullable=True)
    position = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(UTC))
