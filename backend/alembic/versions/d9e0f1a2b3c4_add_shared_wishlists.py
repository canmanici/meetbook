"""add shared wishlists tables

Revision ID: d9e0f1a2b3c4
Revises: c8f9b2fc15d9
Create Date: 2026-07-01 00:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "d9e0f1a2b3c4"
down_revision: str | None = "c8f9b2fc15d9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "shared_wishlists",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column(
            "owner_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index("ix_shared_wishlists_owner_id", "shared_wishlists", ["owner_id"])

    op.create_table(
        "shared_wishlist_members",
        sa.Column(
            "wishlist_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("shared_wishlists.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id"),
            nullable=False,
        ),
        sa.Column(
            "joined_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.PrimaryKeyConstraint("wishlist_id", "user_id"),
    )
    op.create_index(
        "ix_shared_wishlist_members_user_id",
        "shared_wishlist_members",
        ["user_id"],
    )

    op.create_table(
        "shared_wishlist_items",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "wishlist_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("shared_wishlists.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "added_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id"),
            nullable=False,
        ),
        sa.Column("isbn", sa.String(20), nullable=True),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("author", sa.String(200), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index(
        "ix_shared_wishlist_items_wishlist_id",
        "shared_wishlist_items",
        ["wishlist_id"],
    )
    op.create_index(
        "ix_shared_wishlist_items_added_by",
        "shared_wishlist_items",
        ["added_by"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_shared_wishlist_items_added_by", table_name="shared_wishlist_items"
    )
    op.drop_index(
        "ix_shared_wishlist_items_wishlist_id", table_name="shared_wishlist_items"
    )
    op.drop_table("shared_wishlist_items")
    op.drop_index(
        "ix_shared_wishlist_members_user_id", table_name="shared_wishlist_members"
    )
    op.drop_table("shared_wishlist_members")
    op.drop_index("ix_shared_wishlists_owner_id", table_name="shared_wishlists")
    op.drop_table("shared_wishlists")
