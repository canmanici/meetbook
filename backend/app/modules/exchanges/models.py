"""SQLAlchemy models for the exchange lifecycle module."""

import enum
import uuid
from datetime import UTC, datetime

from geoalchemy2 import Geography
from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Index,
    Integer,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID

from app.core.db import Base


class ExchangeStatus(str, enum.Enum):
    pending = "pending"
    accepted = "accepted"
    rejected = "rejected"
    cancelled = "cancelled"
    meetup_proposed = "meetup_proposed"
    meetup_confirmed = "meetup_confirmed"
    completion_pending = "completion_pending"
    completed = "completed"
    expired = "expired"
    # Borrow-mode statuses
    lent = "lent"  # book handed over, currently on loan
    return_pending = "return_pending"  # borrower marked returned, awaiting owner confirm
    overdue = "overdue"  # past due_at, set by the loan_reminders worker


class ExchangeMode(str, enum.Enum):
    trade = "trade"  # permanent swap (legacy default)
    borrow = "borrow"  # time-limited loan, book is returned


# Statuses not yet rejected/cancelled/completed/expired — duplicate guard, uq_active_request,
# and the books delete guard all key off this set.
ACTIVE_STATUSES = (
    ExchangeStatus.pending,
    ExchangeStatus.accepted,
    ExchangeStatus.meetup_proposed,
    ExchangeStatus.meetup_confirmed,
    ExchangeStatus.completion_pending,
    ExchangeStatus.lent,
    ExchangeStatus.return_pending,
    ExchangeStatus.overdue,
)

# A borrower may have at most one of these at a time across all books (single active loan rule).
ACTIVE_LOAN_STATUSES = (
    ExchangeStatus.lent,
    ExchangeStatus.return_pending,
    ExchangeStatus.overdue,
)


class ExtensionStatus(str, enum.Enum):
    none = "none"
    pending = "pending"
    approved = "approved"
    rejected = "rejected"


class ExchangeRequest(Base):
    __tablename__ = "exchange_requests"
    __table_args__ = (
        Index("ix_exchange_requests_book_id", "book_id"),
        Index("ix_exchange_requests_requested_by", "requested_by"),
        Index("ix_exchange_requests_requested_to", "requested_to"),
        Index("ix_exchange_requests_expiry", "status", "expires_at"),
        CheckConstraint(
            "requested_by <> requested_to", name="ck_exchange_requests_no_self_request"
        ),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid7)
    book_id = Column(UUID(as_uuid=True), ForeignKey("books.id"), nullable=False)
    requested_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    requested_to = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    status = Column(
        Enum(ExchangeStatus, name="exchange_status", create_type=True),
        nullable=False,
        default=ExchangeStatus.pending,
    )
    initial_message = Column(Text, nullable=False)
    completion_marked_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    expires_at = Column(DateTime(timezone=True), nullable=False)

    # Borrow-mode fields (null for trade-mode requests).
    mode = Column(
        Enum(ExchangeMode, name="exchange_mode", create_type=True),
        nullable=False,
        default=ExchangeMode.trade,
        server_default=ExchangeMode.trade.value,
    )
    loan_duration_days = Column(Integer, nullable=True)
    due_at = Column(DateTime(timezone=True), nullable=True)
    lent_at = Column(DateTime(timezone=True), nullable=True)
    lent_photo_url = Column(Text, nullable=True)
    returned_marked_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    returned_photo_url = Column(Text, nullable=True)
    returned_confirmed_at = Column(DateTime(timezone=True), nullable=True)
    # Captured at mark_returned time: was the book returned on/before due_at?
    returned_on_time = Column(Boolean, nullable=True)
    extension_requested_days = Column(Integer, nullable=True)
    extension_status = Column(
        Enum(ExtensionStatus, name="extension_status", create_type=True),
        nullable=False,
        default=ExtensionStatus.none,
        server_default=ExtensionStatus.none.value,
    )
    # B20: Book Retirement Flow — recorded when the receiver retires a traded book.
    retired_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    retired_at = Column(DateTime(timezone=True), nullable=True)

    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(UTC))
    updated_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(UTC))


class Block(Base):
    __tablename__ = "blocks"
    __table_args__ = (
        CheckConstraint("blocker_id <> blocked_id", name="ck_blocks_no_self_block"),
    )

    blocker_id = Column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    blocked_id = Column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(UTC))


class Chat(Base):
    __tablename__ = "chats"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid7)
    exchange_request_id = Column(
        UUID(as_uuid=True),
        ForeignKey("exchange_requests.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )
    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(UTC),
    )


class MeetupValidationStatus(str, enum.Enum):
    auto = "auto"
    warning = "warning"
    rejected = "rejected"


class Meetup(Base):
    __tablename__ = "meetups"
    __table_args__ = (
        Index("ix_meetups_geom", "geom", postgresql_using="gist"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid7)
    exchange_request_id = Column(
        UUID(as_uuid=True),
        ForeignKey("exchange_requests.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )
    place_id = Column(Text, nullable=True)
    place_name = Column(Text, nullable=False)
    address = Column(Text, nullable=True)
    category = Column(Text, nullable=True)
    lat = Column(Float, nullable=False)
    lng = Column(Float, nullable=False)
    geom = Column(Geography(geometry_type="POINT", srid=4326), nullable=False)
    validation_status = Column(
        Enum(MeetupValidationStatus, name="meetup_validation_status", create_type=True),
        nullable=False,
    )
    scheduled_at = Column(DateTime(timezone=True), nullable=False)
    proposed_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    proposer_acknowledged = Column(Boolean, nullable=False, default=False)
    other_acknowledged = Column(Boolean, nullable=False, default=False)
    # List of {place_id, place_name, address, category, lat, lng, scheduled_at,
    # validation_status} dicts — the current proposer's candidate places/times.
    # offers[0] always mirrors the canonical place_*/lat/lng/scheduled_at fields above.
    offers = Column(JSONB, nullable=False, default=list, server_default="[]")
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(UTC))
    updated_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(UTC))


class BlockedPlace(Base):
    __tablename__ = "blocked_places"
    __table_args__ = (
        Index("ix_blocked_places_geom", "geom", postgresql_using="gist"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid7)
    place_id = Column(Text, nullable=True)
    lat = Column(Float, nullable=False)
    lng = Column(Float, nullable=False)
    geom = Column(Geography(geometry_type="POINT", srid=4326), nullable=False)
    reason = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(UTC))


class CountryBoundary(Base):
    __tablename__ = "country_boundaries"

    name = Column(Text, primary_key=True)
    geom = Column(Geography(geometry_type="POLYGON", srid=4326), nullable=False)


class ReadingBuddyStatus(str, enum.Enum):
    pending = "pending"
    accepted = "accepted"
    declined = "declined"


class ReadingBuddy(Base):
    __tablename__ = "reading_buddies"
    __table_args__ = (
        Index("ix_reading_buddies_exchange_id", "exchange_id"),
        Index("ix_reading_buddies_user_id", "user_id"),
        Index("ix_reading_buddies_buddy_id", "buddy_id"),
        CheckConstraint("user_id <> buddy_id", name="ck_reading_buddies_no_self"),
        UniqueConstraint("exchange_id", name="uq_reading_buddies_per_exchange"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid7)
    exchange_id = Column(
        UUID(as_uuid=True),
        ForeignKey("exchange_requests.id", ondelete="CASCADE"),
        nullable=False,
    )
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    buddy_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    chat_id = Column(UUID(as_uuid=True), ForeignKey("chats.id"), nullable=True)
    book_id = Column(UUID(as_uuid=True), ForeignKey("books.id"), nullable=False)
    status = Column(
        Enum(ReadingBuddyStatus, name="reading_buddy_status", create_type=True),
        nullable=False,
        default=ReadingBuddyStatus.pending,
        server_default=ReadingBuddyStatus.pending.value,
    )
    created_at = Column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(UTC)
    )
