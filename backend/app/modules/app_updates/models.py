"""Self-hosted app releases (APK updates outside the Play Store)."""

import uuid
from datetime import UTC, datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class AppRelease(Base):
    __tablename__ = "app_releases"
    __table_args__ = (
        UniqueConstraint("platform", "version_code", name="uq_app_releases_platform_code"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid7)
    platform: Mapped[str] = mapped_column(String(10), nullable=False, default="android")
    # Android versionCode — strictly increasing; the update check compares this.
    version_code: Mapped[int] = mapped_column(Integer, nullable=False)
    version_name: Mapped[str] = mapped_column(String(30), nullable=False)
    storage_key: Mapped[str] = mapped_column(Text, nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    md5: Mapped[str] = mapped_column(String(32), nullable=False)
    changelog: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Users below this release MUST update (can't dismiss the prompt).
    mandatory: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # Inactive releases are never offered (pull a broken build instantly).
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    # Emergency: a withdrawn release is never offered, and devices RUNNING it
    # are told it's broken (see LatestResponse.current_withdrawn).
    withdrawn_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    withdrawn_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    uploaded_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(UTC)
    )


class AppUpdatePolicy(Base):
    """One row per platform: the oldest versionCode still allowed to run."""

    __tablename__ = "app_update_policies"

    platform: Mapped[str] = mapped_column(String(10), primary_key=True)
    min_supported_code: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    message: Mapped[str | None] = mapped_column(Text, nullable=True)
    updated_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(UTC)
    )
