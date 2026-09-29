"""Book-credit ledger.

Every credit movement is one immutable row; `users.credit_balance` is the
running total, updated in the same transaction. The ledger is the audit trail
(and lets us rebuild the balance if the cached column ever drifts).
"""

import enum
import uuid
from datetime import UTC, datetime

from sqlalchemy import DateTime, Enum, ForeignKey, Index, Integer, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class CreditKind(str, enum.Enum):
    starter = "starter"  # one-off grant on university-email verification
    trade_given = "trade_given"  # owner handed a book over (+1)
    trade_received = "trade_received"  # requester received a book (-1)
    loan_deposit_hold = "loan_deposit_hold"  # borrower's deposit locked at hand-over (-N)
    loan_deposit_release = "loan_deposit_release"  # book returned, deposit back (+N)
    loan_deposit_award = "loan_deposit_award"  # book never came back: owner gets the deposit (+N)


class CreditTransaction(Base):
    __tablename__ = "credit_transactions"
    __table_args__ = (
        Index("ix_credit_transactions_user_created", "user_id", "created_at"),
        # One movement of each kind per user per exchange — replays are no-ops.
        Index(
            "uq_credit_tx_user_exchange_kind",
            "user_id",
            "exchange_id",
            "kind",
            unique=True,
            postgresql_where=text("exchange_id IS NOT NULL"),
        ),
        # The starter credit is granted once per user, ever.
        Index(
            "uq_credit_tx_starter_once",
            "user_id",
            unique=True,
            postgresql_where=text("kind = 'starter'"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid7)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    amount: Mapped[int] = mapped_column(Integer, nullable=False)
    kind: Mapped[CreditKind] = mapped_column(
        Enum(CreditKind, name="credit_kind", create_type=True), nullable=False
    )
    exchange_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("exchange_requests.id", ondelete="SET NULL"),
        nullable=True,
    )
    balance_after: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(UTC)
    )
