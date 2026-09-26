"""wishlist_items.isbn nullable — allow title-only wishlist entries

Revision ID: a7d1e2f3c4b5
Revises: f5e4d3c2b1a0
Create Date: 2026-09-25 12:00:00.000000

"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "a7d1e2f3c4b5"
down_revision: str | None = "f5e4d3c2b1a0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.alter_column("wishlist_items", "isbn", existing_type=sa.Text(), nullable=True)


def downgrade() -> None:
    op.execute("DELETE FROM wishlist_items WHERE isbn IS NULL")
    op.alter_column("wishlist_items", "isbn", existing_type=sa.Text(), nullable=False)
