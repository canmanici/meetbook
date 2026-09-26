"""Self-hosted app releases (APK updates outside the Play Store)."""

import uuid
from datetime import UTC, datetime

from sqlalchemy import BigInteger, Boolean, Column, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID

from app.core.db import Base


class AppRelease(Base):
    __tablename__ = "app_releases"
    __table_args__ = (UniqueConstraint("platform", "version_code", name="uq_app_releases_platform_code"),)

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid7)
    platform = Column(String(10), nullable=False, default="android")
    # Android versionCode — strictly increasing; the update check compares this.
    version_code = Column(Integer, nullable=False)
    version_name = Column(String(30), nullable=False)
    storage_key = Column(Text, nullable=False)
    size_bytes = Column(BigInteger, nullable=False)
    sha256 = Column(String(64), nullable=False)
    md5 = Column(String(32), nullable=False)
    changelog = Column(Text, nullable=True)
    # Users below this release MUST update (can't dismiss the prompt).
    mandatory = Column(Boolean, nullable=False, default=False)
    # Inactive releases are never offered (pull a broken build instantly).
    is_active = Column(Boolean, nullable=False, default=True)
    uploaded_by = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(UTC))
