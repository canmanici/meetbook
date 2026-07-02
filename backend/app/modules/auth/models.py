"""SQLAlchemy models for authentication and audit."""

import enum
import uuid
from datetime import UTC, datetime

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import INET, JSONB, UUID
from sqlalchemy.orm import relationship

from app.core.db import Base


class UserStatus(str, enum.Enum):
    active = "active"
    suspended = "suspended"
    deleted = "deleted"
    banned = "banned"


class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid7)
    email = Column(String(255), unique=True, nullable=False, index=True)
    name = Column(String(100), nullable=False)
    phone = Column(String(20), nullable=True)
    phone_verified_at = Column(DateTime(timezone=True), nullable=True)
    email_verified_at = Column(DateTime(timezone=True), nullable=True)
    status = Column(
        Enum(UserStatus, name="user_status", create_type=True),
        nullable=False,
        default=UserStatus.active,
    )
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(UTC))
    updated_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(UTC))
    last_active_at = Column(DateTime(timezone=True), nullable=True)
    kvkk_consent_at = Column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(UTC)
    )
    kvkk_policy_version = Column(String(20), nullable=False, default="1.0")
    completed_exchanges = Column(Integer, nullable=False, default=0)
    trusted_contact_name = Column(String(100), nullable=True)
    trusted_contact_phone = Column(String(20), nullable=True)
    rating_average = Column(Numeric(3, 2), nullable=False, default=0)
    rating_count = Column(Integer, nullable=False, default=0)
    # Borrow/lending trust metrics
    loans_borrowed_count = Column(Integer, nullable=False, default=0, server_default="0")
    loans_returned_on_time = Column(Integer, nullable=False, default=0, server_default="0")
    loans_returned_late = Column(Integer, nullable=False, default=0, server_default="0")
    # Admin manual override of the computed trust score (0-100). Null → use computed value.
    trust_score_override = Column(Numeric(5, 2), nullable=True)
    geofence_radius_km = Column(Integer, nullable=False, default=10, server_default="10")
    avatar_url = Column(String(500), nullable=True)
    is_admin = Column(Boolean, nullable=False, default=False)
    # B11: per-event push notification toggles (event_name -> bool)
    notification_settings = Column(JSONB, nullable=False, default=dict, server_default="{}")
    # B17: smart rules to auto-accept matching exchange requests
    auto_accept_rules = Column(JSONB, nullable=False, default=list, server_default="[]")

    # Relationships
    credential = relationship("UserCredential", back_populates="user", uselist=False)
    refresh_tokens = relationship("RefreshToken", back_populates="user")


class UserCredential(Base):
    __tablename__ = "user_credentials"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid7)
    user_id = Column(
        UUID(as_uuid=True), ForeignKey("users.id"), unique=True, nullable=False
    )
    password_hash = Column(String(255), nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(UTC))
    updated_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(UTC))

    user = relationship("User", back_populates="credential")


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"
    __table_args__ = (
        Index("ix_refresh_tokens_family_id", "family_id"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid7)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    token_hash = Column(String(64), unique=True, nullable=False)
    family_id = Column(UUID(as_uuid=True), nullable=False)
    device_info = Column(JSONB, nullable=True)
    revoked_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(UTC))
    expires_at = Column(DateTime(timezone=True), nullable=False)

    user = relationship("User", back_populates="refresh_tokens")


class PasswordResetToken(Base):
    __tablename__ = "password_reset_tokens"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid7)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    token_hash = Column(String(64), unique=True, nullable=False)
    used_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(UTC))
    expires_at = Column(DateTime(timezone=True), nullable=False)


class AuditLog(Base):
    __tablename__ = "audit_log"
    __table_args__ = (
        Index("ix_audit_log_user_id", "user_id"),
        Index("ix_audit_log_event_type", "event_type"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid7)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    event_type = Column(String(50), nullable=False)
    ip_address = Column(INET, nullable=True)
    user_agent = Column(Text, nullable=True)
    metadata_ = Column("metadata", JSONB, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(UTC))


class Vouch(Base):
    """B25: a user vouches for another user's trustworthiness."""

    __tablename__ = "vouches"

    voucher_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), primary_key=True)
    vouchee_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), primary_key=True)
    note = Column(Text, nullable=True)
    created_at = Column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(UTC)
    )
