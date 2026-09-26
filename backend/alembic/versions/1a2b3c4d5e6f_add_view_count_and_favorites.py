"""add view_count and book_favorites table

Revision ID: 1a2b3c4d5e6f
Revises: 0e4d7365716a
Create Date: 2026-06-15 12:00:00.000000

"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision: str = "1a2b3c4d5e6f"
down_revision: str | None = "a9b8c7d6e5f4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Add view_count and favorite_count to books table
    op.add_column(
        "books", sa.Column("view_count", sa.Integer(), nullable=False, server_default="0")
    )
    op.add_column(
        "books", sa.Column("favorite_count", sa.Integer(), nullable=False, server_default="0")
    )

    # Create book_favorites table
    op.create_table(
        "book_favorites",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, default=sa.text("gen_random_uuid()")),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column(
            "book_id",
            UUID(as_uuid=True),
            sa.ForeignKey("books.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.UniqueConstraint("user_id", "book_id", name="uq_user_book_favorite"),
    )
    op.create_index("ix_book_favorites_book_id", "book_favorites", ["book_id"])
    op.create_index("ix_book_favorites_user_id", "book_favorites", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_book_favorites_user_id", table_name="book_favorites")
    op.drop_index("ix_book_favorites_book_id", table_name="book_favorites")
    op.drop_table("book_favorites")
    op.drop_column("books", "favorite_count")
    op.drop_column("books", "view_count")
