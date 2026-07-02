"""SQLAlchemy model for push notification tokens."""

import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class PushToken(Base):
    __tablename__ = "push_tokens"
    __table_args__ = (
        UniqueConstraint("token", name="uq_push_tokens_token"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid7
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    token: Mapped[str] = mapped_column(
        String(255), nullable=False, comment="Expo push token"
    )
    platform: Mapped[str] = mapped_column(
        String(20), nullable=False, comment="android | ios"
    )
    device_id: Mapped[str | None] = mapped_column(
        String(100), nullable=True, comment="Device unique ID for dedup"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
