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
    Text,
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


# Statuses not yet rejected/cancelled/completed/expired — duplicate guard, uq_active_request,
# and the books delete guard all key off this set.
ACTIVE_STATUSES = (
    ExchangeStatus.pending,
    ExchangeStatus.accepted,
    ExchangeStatus.meetup_proposed,
    ExchangeStatus.meetup_confirmed,
    ExchangeStatus.completion_pending,
)


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

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
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

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
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

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
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

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
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
