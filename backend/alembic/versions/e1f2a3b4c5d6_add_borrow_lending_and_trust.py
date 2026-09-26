"""add borrow/lending lifecycle, trust metrics, banned status

Revision ID: e1f2a3b4c5d6
Revises: 1a2b3c4d5e6f
Create Date: 2026-06-19 12:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql
from sqlalchemy.dialects.postgresql import UUID

revision: str = "e1f2a3b4c5d6"
down_revision: str | None = "1a2b3c4d5e6f"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # --- New enum values on existing types ---
    op.execute("ALTER TYPE exchange_status ADD VALUE IF NOT EXISTS 'lent'")
    op.execute("ALTER TYPE exchange_status ADD VALUE IF NOT EXISTS 'return_pending'")
    op.execute("ALTER TYPE exchange_status ADD VALUE IF NOT EXISTS 'overdue'")
    op.execute("ALTER TYPE user_status ADD VALUE IF NOT EXISTS 'banned'")

    # --- New enum types ---
    op.execute("CREATE TYPE exchange_mode AS ENUM ('trade', 'borrow')")
    op.execute("CREATE TYPE extension_status AS ENUM ('none', 'pending', 'approved', 'rejected')")
    exchange_mode = postgresql.ENUM("trade", "borrow", name="exchange_mode", create_type=False)
    extension_status = postgresql.ENUM(
        "none", "pending", "approved", "rejected", name="extension_status", create_type=False
    )

    # --- exchange_requests borrow columns ---
    op.add_column(
        "exchange_requests",
        sa.Column("mode", exchange_mode, nullable=False, server_default="trade"),
    )
    op.add_column("exchange_requests", sa.Column("loan_duration_days", sa.Integer(), nullable=True))
    op.add_column(
        "exchange_requests", sa.Column("due_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column(
        "exchange_requests", sa.Column("lent_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column("exchange_requests", sa.Column("lent_photo_url", sa.Text(), nullable=True))
    op.add_column(
        "exchange_requests",
        sa.Column(
            "returned_marked_by", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True
        ),
    )
    op.add_column("exchange_requests", sa.Column("returned_photo_url", sa.Text(), nullable=True))
    op.add_column(
        "exchange_requests",
        sa.Column("returned_confirmed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column("exchange_requests", sa.Column("returned_on_time", sa.Boolean(), nullable=True))
    op.add_column(
        "exchange_requests", sa.Column("extension_requested_days", sa.Integer(), nullable=True)
    )
    op.add_column(
        "exchange_requests",
        sa.Column("extension_status", extension_status, nullable=False, server_default="none"),
    )

    # --- users trust columns ---
    op.add_column(
        "users", sa.Column("loans_borrowed_count", sa.Integer(), nullable=False, server_default="0")
    )
    op.add_column(
        "users",
        sa.Column("loans_returned_on_time", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "users", sa.Column("loans_returned_late", sa.Integer(), nullable=False, server_default="0")
    )
    op.add_column("users", sa.Column("trust_score_override", sa.Numeric(5, 2), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "trust_score_override")
    op.drop_column("users", "loans_returned_late")
    op.drop_column("users", "loans_returned_on_time")
    op.drop_column("users", "loans_borrowed_count")

    op.drop_column("exchange_requests", "extension_status")
    op.drop_column("exchange_requests", "extension_requested_days")
    op.drop_column("exchange_requests", "returned_on_time")
    op.drop_column("exchange_requests", "returned_confirmed_at")
    op.drop_column("exchange_requests", "returned_photo_url")
    op.drop_column("exchange_requests", "returned_marked_by")
    op.drop_column("exchange_requests", "lent_photo_url")
    op.drop_column("exchange_requests", "lent_at")
    op.drop_column("exchange_requests", "due_at")
    op.drop_column("exchange_requests", "loan_duration_days")
    op.drop_column("exchange_requests", "mode")

    op.execute("DROP TYPE extension_status")
    op.execute("DROP TYPE exchange_mode")
    # Note: enum *values* added to exchange_status / user_status are not removed
    # (Postgres has no DROP VALUE); this is a one-way data migration.
