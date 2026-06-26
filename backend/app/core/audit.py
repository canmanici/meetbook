"""Audit log service — fire-and-forget event logging."""

import logging
import uuid
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.auth.models import AuditLog

logger = logging.getLogger(__name__)


async def log_event(
    session: AsyncSession,
    event_type: str,
    user_id: uuid.UUID | None = None,
    ip_address: str | None = None,
    user_agent: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> None:
    """Insert an audit log entry. Failures are logged but do not block the request."""
    try:
        entry = AuditLog(
            event_type=event_type,
            user_id=user_id,
            ip_address=ip_address,
            user_agent=user_agent,
            metadata_=metadata,
        )
        session.add(entry)
        await session.flush()
    except Exception:
        logger.exception("Failed to write audit log for event: %s", event_type)
