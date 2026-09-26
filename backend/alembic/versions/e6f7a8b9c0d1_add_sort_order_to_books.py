"""add sort_order column to books table

Revision ID: e6f7a8b9c0d1
Revises: a5b6c7d8e9f0
Create Date: 2026-06-21 15:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "e6f7a8b9c0d1"
down_revision: Union[str, None] = "a5b6c7d8e9f0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "books",
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default=sa.text("0")),
    )

    op.execute(
        """
        WITH numbered AS (
            SELECT id, owner_id, ROW_NUMBER() OVER (
                PARTITION BY owner_id ORDER BY created_at DESC, id DESC
            ) - 1 AS rn
            FROM books
            WHERE deleted_at IS NULL
        )
        UPDATE books SET sort_order = numbered.rn
        FROM numbered
        WHERE books.id = numbered.id
        """
    )

    op.execute("UPDATE books SET sort_order = 999999 WHERE deleted_at IS NOT NULL")


def downgrade() -> None:
    op.drop_column("books", "sort_order")
