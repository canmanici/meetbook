"""book credits ledger + university (.edu.tr) verification

Revision ID: d7e8f9a0b1c2
Revises: c4d5e6f7a8b9
Create Date: 2026-09-29
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "d7e8f9a0b1c2"
down_revision: str | None = "c4d5e6f7a8b9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

CREDIT_KINDS = (
    "starter",
    "trade_given",
    "trade_received",
    "loan_deposit_hold",
    "loan_deposit_release",
    "loan_deposit_award",
)


def upgrade() -> None:
    op.add_column("users", sa.Column("edu_email", sa.String(255), nullable=True))
    op.add_column("users", sa.Column("edu_verified_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("users", sa.Column("pending_edu_email", sa.String(255), nullable=True))
    op.add_column(
        "users",
        sa.Column("credit_balance", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "users", sa.Column("borrow_banned_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.create_unique_constraint("users_edu_email_key", "users", ["edu_email"])

    credit_kind = postgresql.ENUM(*CREDIT_KINDS, name="credit_kind", create_type=False)
    credit_kind.create(op.get_bind(), checkfirst=True)

    op.create_table(
        "credit_transactions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("amount", sa.Integer(), nullable=False),
        sa.Column("kind", credit_kind, nullable=False),
        sa.Column(
            "exchange_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("exchange_requests.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("balance_after", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_credit_transactions_user_created", "credit_transactions", ["user_id", "created_at"]
    )
    op.create_index(
        "uq_credit_tx_user_exchange_kind",
        "credit_transactions",
        ["user_id", "exchange_id", "kind"],
        unique=True,
        postgresql_where=sa.text("exchange_id IS NOT NULL"),
    )
    op.create_index(
        "uq_credit_tx_starter_once",
        "credit_transactions",
        ["user_id"],
        unique=True,
        postgresql_where=sa.text("kind = 'starter'"),
    )


def downgrade() -> None:
    op.drop_table("credit_transactions")
    postgresql.ENUM(name="credit_kind").drop(op.get_bind(), checkfirst=True)
    op.drop_constraint("users_edu_email_key", "users", type_="unique")
    for column in (
        "borrow_banned_at",
        "credit_balance",
        "pending_edu_email",
        "edu_verified_at",
        "edu_email",
    ):
        op.drop_column("users", column)
