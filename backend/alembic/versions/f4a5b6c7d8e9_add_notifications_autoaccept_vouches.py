"""add notification settings, auto-accept rules, and vouches table

Revision ID: f4a5b6c7d8e9
Revises: c8f9b2fc15d9
Create Date: 2026-07-01 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "f4a5b6c7d8e9"
down_revision: str | None = "c8f9b2fc15d9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # B11: per-event push notification preferences (event_name -> bool)
    op.add_column(
        "users",
        sa.Column(
            "notification_settings",
            postgresql.JSONB(),
            nullable=False,
            server_default="{}",
        ),
    )
    # B17: smart auto-accept rules for exchange requests
    op.add_column(
        "users",
        sa.Column(
            "auto_accept_rules",
            postgresql.JSONB(),
            nullable=False,
            server_default="[]",
        ),
    )
    # B25: vouching system
    op.create_table(
        "vouches",
        sa.Column("voucher_id", sa.UUID(), nullable=False),
        sa.Column("vouchee_id", sa.UUID(), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["voucher_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["vouchee_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("voucher_id", "vouchee_id"),
    )


def downgrade() -> None:
    op.drop_table("vouches")
    op.drop_column("users", "auto_accept_rules")
    op.drop_column("users", "notification_settings")
