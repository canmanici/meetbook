"""SQLAlchemy models for the books module."""

import enum
import uuid
from datetime import UTC, datetime

from geoalchemy2 import Geography
from sqlalchemy import Boolean, Column, DateTime, Enum, ForeignKey, Index, Integer, Text
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

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    owner_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    title = Column(Text, nullable=False)
    author = Column(Text, nullable=True)
    isbn = Column(Text, nullable=True)
    description = Column(Text, nullable=True)
    category = Column(
        Enum(BookCategory, name="book_category", create_type=True), nullable=False
    )
    language = Column(Text, nullable=False, default="tr")
    condition = Column(
        Enum(BookCondition, name="book_condition", create_type=True), nullable=False
    )
    is_available = Column(Boolean, nullable=False, default=True)
    location = Column(Geography(geometry_type="POINT", srid=4326), nullable=False)
    public_location = Column(Geography(geometry_type="POINT", srid=4326), nullable=False)
    deleted_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(UTC))
    updated_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(UTC))


class BookPhoto(Base):
    __tablename__ = "book_photos"
    __table_args__ = (
        Index("ix_book_photos_book_id", "book_id"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    book_id = Column(UUID(as_uuid=True), ForeignKey("books.id", ondelete="CASCADE"), nullable=False)
    url = Column(Text, nullable=False)
    position = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(UTC))
