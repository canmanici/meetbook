"""add book retirement columns and reading buddies table

Merges the three prior heads (chat pin/mute, shared wishlists,
notifications/auto-accept/vouches) and introduces:

- B20: Book Retirement Flow — retired_by/retired_at on exchange_requests.
- B24: Reading Buddy Matching — reading_buddies table + reading_buddy_status enum.

Revision ID: e2a3b4c5d6e7
Revises: b3c4d5e6f7a8, d9e0f1a2b3c4, f4a5b6c7d8e9
Create Date: 2026-07-01 18:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "e2a3b4c5d6e7"
down_revision: str | Sequence[str] | None = ("b3c4d5e6f7a8", "d9e0f1a2b3c4", "f4a5b6c7d8e9")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # --- B20: Book Retirement Flow ---
    op.add_column(
        "exchange_requests",
        sa.Column(
            "retired_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id"),
            nullable=True,
        ),
    )
    op.add_column(
        "exchange_requests",
        sa.Column("retired_at", sa.DateTime(timezone=True), nullable=True),
    )

    # --- B24: Reading Buddy Matching ---
    op.execute(
        "CREATE TYPE reading_buddy_status AS ENUM ('pending', 'accepted', 'declined')"
    )
    reading_buddy_status = postgresql.ENUM(
        "pending", "accepted", "declined", name="reading_buddy_status", create_type=False
    )
    op.create_table(
        "reading_buddies",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "exchange_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("exchange_requests.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id"),
            nullable=False,
        ),
        sa.Column(
            "buddy_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id"),
            nullable=False,
        ),
        sa.Column(
            "chat_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("chats.id"),
            nullable=True,
        ),
        sa.Column(
            "book_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("books.id"),
            nullable=False,
        ),
        sa.Column(
            "status", reading_buddy_status, nullable=False, server_default="pending"
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.CheckConstraint("user_id <> buddy_id", name="ck_reading_buddies_no_self"),
        sa.UniqueConstraint("exchange_id", name="uq_reading_buddies_per_exchange"),
    )
    op.create_index("ix_reading_buddies_exchange_id", "reading_buddies", ["exchange_id"])
    op.create_index("ix_reading_buddies_user_id", "reading_buddies", ["user_id"])
    op.create_index("ix_reading_buddies_buddy_id", "reading_buddies", ["buddy_id"])


def downgrade() -> None:
    op.drop_index("ix_reading_buddies_buddy_id", table_name="reading_buddies")
    op.drop_index("ix_reading_buddies_user_id", table_name="reading_buddies")
    op.drop_index("ix_reading_buddies_exchange_id", table_name="reading_buddies")
    op.drop_table("reading_buddies")
    op.execute("DROP TYPE reading_buddy_status")
    op.drop_column("exchange_requests", "retired_at")
    op.drop_column("exchange_requests", "retired_by")
