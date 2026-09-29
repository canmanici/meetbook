"""Book-credit rules.

Give a book → +1. Receive a book → -1. Borrowing locks a deposit that comes
back when the book does, and goes to the owner when it doesn't.

- University-verified students get STARTER_CREDITS once and may go down to
  -DEBT_LIMIT: a freshman with an empty shelf can take a course book now and
  pay it back by re-listing it after the course.
- Everyone else can't go below zero.
- A deposit can never be paid with debt — you can only borrow with credits
  you actually hold, so a fresh account cannot walk off with a book for free.
- Credits are never convertible to money (that would make them e-money).
"""

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.modules.auth.models import User
from app.modules.credits.models import CreditKind, CreditTransaction
from app.modules.exchanges.models import ExchangeMode, ExchangeRequest, ExchangeStatus

STARTER_CREDITS = 1
TRADE_COST = 1
DEBT_LIMIT = 2
LOAN_DEPOSIT = 2

# Trade requests whose credit is spoken for: the book has not changed hands
# yet, but the requester can't promise the same credit to another owner.
_RESERVING_STATUSES = (
    ExchangeStatus.pending,
    ExchangeStatus.accepted,
    ExchangeStatus.meetup_proposed,
    ExchangeStatus.meetup_confirmed,
    ExchangeStatus.completion_pending,
)


class CreditError(Exception):
    def __init__(self, code: str, status_code: int = 409) -> None:
        self.code = code
        self.status_code = status_code


@dataclass(frozen=True)
class Wallet:
    balance: int
    reserved: int
    available: int
    floor: int
    can_borrow: bool
    borrow_banned: bool


def credit_floor(user: User) -> int:
    return -DEBT_LIMIT if user.edu_verified_at is not None else 0


class CreditService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    @property
    def enforced(self) -> bool:
        return get_settings().credits_enforced

    async def _lock_user(self, user_id: uuid.UUID) -> User:
        result = await self.session.execute(
            select(User).where(User.id == user_id).with_for_update()
        )
        return result.scalar_one()

    async def _existing(
        self, user_id: uuid.UUID, kind: CreditKind, exchange_id: uuid.UUID | None
    ) -> CreditTransaction | None:
        stmt = select(CreditTransaction).where(
            CreditTransaction.user_id == user_id, CreditTransaction.kind == kind
        )
        if exchange_id is not None:
            stmt = stmt.where(CreditTransaction.exchange_id == exchange_id)
        return (await self.session.execute(stmt.limit(1))).scalar_one_or_none()

    async def _apply(
        self,
        user_id: uuid.UUID,
        amount: int,
        kind: CreditKind,
        exchange_id: uuid.UUID | None = None,
    ) -> bool:
        """Move credits once. Returns False if this movement already happened."""
        if await self._existing(user_id, kind, exchange_id) is not None:
            return False
        balance = (
            await self.session.execute(
                update(User)
                .where(User.id == user_id)
                .values(credit_balance=User.credit_balance + amount)
                .returning(User.credit_balance)
            )
        ).scalar_one()
        self.session.add(
            CreditTransaction(
                user_id=user_id,
                amount=amount,
                kind=kind,
                exchange_id=exchange_id,
                balance_after=balance,
            )
        )
        await self.session.flush()
        return True

    async def reserved(self, user_id: uuid.UUID, exclude: uuid.UUID | None = None) -> int:
        stmt = select(func.count()).where(
            ExchangeRequest.requested_by == user_id,
            ExchangeRequest.mode == ExchangeMode.trade,
            ExchangeRequest.status.in_(_RESERVING_STATUSES),
        )
        if exclude is not None:
            stmt = stmt.where(ExchangeRequest.id != exclude)
        return (await self.session.scalar(stmt)) or 0

    async def wallet(self, user: User) -> Wallet:
        reserved = await self.reserved(user.id) * TRADE_COST
        available = user.credit_balance - reserved
        banned = user.borrow_banned_at is not None
        return Wallet(
            balance=user.credit_balance,
            reserved=reserved,
            available=available,
            floor=credit_floor(user),
            can_borrow=not banned and available >= LOAN_DEPOSIT,
            borrow_banned=banned,
        )

    async def history(self, user_id: uuid.UUID, limit: int = 50) -> list[CreditTransaction]:
        result = await self.session.execute(
            select(CreditTransaction)
            .where(CreditTransaction.user_id == user_id)
            .order_by(CreditTransaction.created_at.desc())
            .limit(limit)
        )
        return list(result.scalars().all())

    # -- Grants -----------------------------------------------------------

    async def grant_starter(self, user_id: uuid.UUID) -> bool:
        await self._lock_user(user_id)
        return await self._apply(user_id, STARTER_CREDITS, CreditKind.starter)

    # -- Checks before a request is created --------------------------------

    async def check_can_request(self, user_id: uuid.UUID, mode: ExchangeMode) -> None:
        user = await self._lock_user(user_id)
        if mode is ExchangeMode.borrow and user.borrow_banned_at is not None:
            raise CreditError("BORROW_BANNED", 403)
        if not self.enforced:
            return
        available = user.credit_balance - await self.reserved(user_id) * TRADE_COST
        if mode is ExchangeMode.borrow:
            if available < LOAN_DEPOSIT:
                raise CreditError("INSUFFICIENT_CREDITS_FOR_DEPOSIT", 409)
        elif available - TRADE_COST < credit_floor(user):
            raise CreditError("INSUFFICIENT_CREDITS", 409)

    # -- Exchange settlement ------------------------------------------------

    async def settle_trade(self, request: ExchangeRequest) -> None:
        """The book changed hands for good: owner earns, requester pays."""
        await self._apply(request.requested_to, TRADE_COST, CreditKind.trade_given, request.id)
        await self._apply(request.requested_by, -TRADE_COST, CreditKind.trade_received, request.id)

    async def hold_deposit(self, request: ExchangeRequest) -> None:
        user = await self._lock_user(request.requested_by)
        if user.borrow_banned_at is not None:
            raise CreditError("BORROW_BANNED", 403)
        if self.enforced:
            available = (
                user.credit_balance - await self.reserved(user.id, exclude=request.id) * TRADE_COST
            )
            if available < LOAN_DEPOSIT:
                raise CreditError("INSUFFICIENT_CREDITS_FOR_DEPOSIT", 409)
        await self._apply(
            request.requested_by, -LOAN_DEPOSIT, CreditKind.loan_deposit_hold, request.id
        )

    async def release_deposit(self, request: ExchangeRequest) -> None:
        hold = await self._existing(request.requested_by, CreditKind.loan_deposit_hold, request.id)
        if hold is None:
            return  # loan started before credits existed
        await self._apply(
            request.requested_by, -hold.amount, CreditKind.loan_deposit_release, request.id
        )

    async def forfeit_deposit(self, request: ExchangeRequest) -> None:
        """The owner gave up on getting the book back: they keep the deposit,
        and the borrower loses borrowing rights for good."""
        hold = await self._existing(request.requested_by, CreditKind.loan_deposit_hold, request.id)
        if hold is not None:
            await self._apply(
                request.requested_to, -hold.amount, CreditKind.loan_deposit_award, request.id
            )
        await self.session.execute(
            update(User)
            .where(User.id == request.requested_by, User.borrow_banned_at.is_(None))
            .values(borrow_banned_at=datetime.now(UTC))
        )
