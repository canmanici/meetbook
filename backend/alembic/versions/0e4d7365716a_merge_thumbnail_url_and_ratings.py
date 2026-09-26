"""merge thumbnail_url and ratings

Revision ID: 0e4d7365716a
Revises: b2c3d4e5f6g7, b8c9d0e1f2a3
Create Date: 2026-06-15 08:57:40.341344

"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "0e4d7365716a"
down_revision: str | None = ("b2c3d4e5f6g7", "b8c9d0e1f2a3")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
