"""add exchange lifecycle tables

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
Create Date: 2026-06-13 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "c3d4e5f6a7b8"
down_revision: str | None = "b2c3d4e5f6a7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        "CREATE TYPE exchange_status AS ENUM "
        "('pending', 'accepted', 'rejected', 'cancelled', 'meetup_proposed', "
        "'meetup_confirmed', 'completion_pending', 'completed', 'expired')"
    )

    op.add_column(
        "users",
        sa.Column("completed_exchanges", sa.Integer, nullable=False, server_default="0"),
    )

    op.create_table(
        "blocks",
        sa.Column(
            "blocker_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "blocked_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.PrimaryKeyConstraint("blocker_id", "blocked_id"),
        sa.CheckConstraint("blocker_id <> blocked_id", name="ck_blocks_no_self_block"),
    )

    op.create_table(
        "exchange_requests",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "book_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("books.id"), nullable=False
        ),
        sa.Column(
            "requested_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False
        ),
        sa.Column(
            "requested_to", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False
        ),
        sa.Column(
            "status",
            postgresql.ENUM(
                "pending",
                "accepted",
                "rejected",
                "cancelled",
                "meetup_proposed",
                "meetup_confirmed",
                "completion_pending",
                "completed",
                "expired",
                name="exchange_status",
                create_type=False,
            ),
            nullable=False,
            server_default="pending",
        ),
        sa.Column("initial_message", sa.Text, nullable=False),
        sa.Column(
            "completion_marked_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id"),
            nullable=True,
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.CheckConstraint(
            "requested_by <> requested_to", name="ck_exchange_requests_no_self_request"
        ),
    )
    op.create_index("ix_exchange_requests_book_id", "exchange_requests", ["book_id"])
    op.create_index("ix_exchange_requests_requested_by", "exchange_requests", ["requested_by"])
    op.create_index("ix_exchange_requests_requested_to", "exchange_requests", ["requested_to"])
    op.create_index("ix_exchange_requests_expiry", "exchange_requests", ["status", "expires_at"])
    op.create_index(
        "uq_active_request",
        "exchange_requests",
        ["book_id", "requested_by"],
        unique=True,
        postgresql_where=sa.text("status NOT IN ('rejected', 'cancelled', 'completed', 'expired')"),
    )

    op.create_table(
        "chats",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "exchange_request_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("exchange_requests.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
    )


def downgrade() -> None:
    op.drop_table("chats")
    op.drop_index("uq_active_request", table_name="exchange_requests")
    op.drop_index("ix_exchange_requests_expiry", table_name="exchange_requests")
    op.drop_index("ix_exchange_requests_requested_to", table_name="exchange_requests")
    op.drop_index("ix_exchange_requests_requested_by", table_name="exchange_requests")
    op.drop_index("ix_exchange_requests_book_id", table_name="exchange_requests")
    op.drop_table("exchange_requests")
    op.drop_table("blocks")
    op.drop_column("users", "completed_exchanges")
    op.execute("DROP TYPE exchange_status")
