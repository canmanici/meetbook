"""Hourly worker: move overdue pending/accepted exchange requests to `expired`."""

from typing import Any, cast
from datetime import UTC, datetime

from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.exchanges.models import ExchangeRequest, ExchangeStatus
from app.modules.exchanges.state_machine import EXPIRABLE_STATUSES
from sqlalchemy.engine import CursorResult


async def expire_requests(session: AsyncSession) -> int:
    """Mark `pending`/`accepted` exchange requests past `expires_at` as `expired`.

    Returns the number of rows updated.
    """
    stmt = (
        update(ExchangeRequest)
        .where(
            ExchangeRequest.status.in_(EXPIRABLE_STATUSES),
            ExchangeRequest.expires_at < datetime.now(UTC),
        )
        .values(status=ExchangeStatus.expired, updated_at=datetime.now(UTC))
    )
    result = cast(CursorResult[Any], await session.execute(stmt))
    await session.commit()
    return result.rowcount or 0
