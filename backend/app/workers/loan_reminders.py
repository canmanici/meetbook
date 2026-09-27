"""Hourly worker for the borrow/lending lifecycle.

Two responsibilities:

  1. Mark active loans (``lent`` / ``return_pending``) past their ``due_at`` as
     ``overdue`` and notify both parties once.
  2. Send "due soon" reminders to both parties 3 days and 1 day before ``due_at``.

Idempotency: each milestone uses a distinct notification type keyed on the
exchange id, so re-running the worker every hour never double-notifies.
"""

import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.exchanges.models import ExchangeRequest, ExchangeStatus
from app.modules.notifications.repository import NotificationRepository
from app.modules.notifications.service import NotificationService

# Active loan statuses that can become overdue / receive reminders.
_ACTIVE_LOAN = (ExchangeStatus.lent, ExchangeStatus.return_pending, ExchangeStatus.overdue)


_TEXT: dict[str, tuple[str, str, str]] = {
    # type: (title, borrower body, lender body)
    "loan_due_3d": (
        "İade tarihi yaklaşıyor",
        "Ödünç aldığın kitabın iadesine 3 gün kaldı.",
        "Ödünç verdiğin kitabın iadesine 3 gün kaldı.",
    ),
    "loan_due_1d": (
        "İade yarın",
        "Ödünç aldığın kitabı yarın iade etmen gerekiyor.",
        "Ödünç verdiğin kitap yarın geri gelmeli.",
    ),
    "loan_overdue": (
        "İade gecikti",
        "Ödünç aldığın kitabın iade tarihi geçti. Lütfen sahibiyle iletişime geç.",
        "Ödünç verdiğin kitabın iade tarihi geçti.",
    ),
}


async def _notify_once(
    repo: NotificationRepository,
    service: NotificationService,
    user_id: uuid.UUID,
    type_: str,
    request: ExchangeRequest,
) -> bool:
    if await repo.exists_for_exchange(user_id, type_, request.id):
        return False
    title, borrower_body, lender_body = _TEXT[type_]
    # requested_by is the borrower, requested_to the book's owner.
    body = borrower_body if user_id == request.requested_by else lender_body
    await service.notify(
        user_id,
        type_,
        {
            "exchange_id": str(request.id),
            "book_id": str(request.book_id),
            "due_at": request.due_at.isoformat() if request.due_at else None,
        },
        title=title,
        body=body,
    )
    return True


async def run_loan_reminders(session: AsyncSession) -> int:
    """Flip overdue loans and emit due-soon/overdue reminders. Returns notifications sent."""
    from app.modules.exchanges.repository import ExchangeRepository

    exchange_repo = ExchangeRepository(session)
    notif_repo = NotificationRepository(session)
    notif_service = NotificationService(session)
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
            if await _notify_once(notif_repo, notif_service, uid, "loan_overdue", req):
                sent += 1

    # 2. Due-soon reminders (only while still actively lent, not yet returned).
    for days, type_ in ((3, "loan_due_3d"), (1, "loan_due_1d")):
        window_end = now + timedelta(days=days)
        upcoming = await exchange_repo.list_due_loans((ExchangeStatus.lent,), window_end)
        for req in upcoming:
            if req.due_at is None or req.due_at <= now:
                continue  # already overdue, handled above
            for uid in (req.requested_by, req.requested_to):
                if await _notify_once(notif_repo, notif_service, uid, type_, req):
                    sent += 1

    await session.commit()
    return sent
