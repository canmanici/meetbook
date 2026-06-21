"""Hourly worker for the borrow/lending lifecycle.

Two responsibilities:

  1. Mark active loans (``lent`` / ``return_pending``) past their ``due_at`` as
     ``overdue`` and notify both parties once.
  2. Send "due soon" reminders to both parties 3 days and 1 day before ``due_at``.

Idempotency: each milestone uses a distinct notification type keyed on the
exchange id, so re-running the worker every hour never double-notifies.
"""

from datetime import UTC, datetime, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.exchanges.models import ExchangeRequest, ExchangeStatus
from app.modules.notifications.repository import NotificationRepository

# Active loan statuses that can become overdue / receive reminders.
_ACTIVE_LOAN = (ExchangeStatus.lent, ExchangeStatus.return_pending, ExchangeStatus.overdue)


async def _notify_once(
    repo: NotificationRepository, user_id, type_: str, request: ExchangeRequest
) -> bool:
    if await repo.exists_for_exchange(user_id, type_, request.id):
        return False
    await repo.create(
        user_id,
        type_,
        {
            "exchange_id": str(request.id),
            "book_id": str(request.book_id),
            "due_at": request.due_at.isoformat() if request.due_at else None,
        },
    )
    return True


async def run_loan_reminders(session: AsyncSession) -> int:
    """Flip overdue loans and emit due-soon/overdue reminders. Returns notifications sent."""
    from app.modules.exchanges.repository import ExchangeRepository

    exchange_repo = ExchangeRepository(session)
    notif_repo = NotificationRepository(session)
    now = datetime.now(UTC)
    sent = 0

    # 1. Overdue: lent/return_pending whose due_at has passed.
    overdue_loans = await exchange_repo.list_due_loans(
        (ExchangeStatus.lent, ExchangeStatus.return_pending), now
    )
    for req in overdue_loans:
        if req.status is ExchangeStatus.lent:
            req.status = ExchangeStatus.overdue
            req.updated_at = now
        for uid in (req.requested_by, req.requested_to):
            if await _notify_once(notif_repo, uid, "loan_overdue", req):
                sent += 1

    # 2. Due-soon reminders (only while still actively lent, not yet returned).
    for days, type_ in ((3, "loan_due_3d"), (1, "loan_due_1d")):
        window_end = now + timedelta(days=days)
        upcoming = await exchange_repo.list_due_loans((ExchangeStatus.lent,), window_end)
        for req in upcoming:
            if req.due_at is None or req.due_at <= now:
                continue  # already overdue, handled above
            for uid in (req.requested_by, req.requested_to):
                if await _notify_once(notif_repo, uid, type_, req):
                    sent += 1

    await session.commit()
    return sent
