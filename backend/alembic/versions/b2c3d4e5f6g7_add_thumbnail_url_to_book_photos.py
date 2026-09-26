"""add thumbnail_url to book_photos

Revision ID: b2c3d4e5f6g7
Revises: a1b2c3d4e5f6
Create Date: 2026-06-15 00:00:01.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "b2c3d4e5f6g7"
down_revision: str | None = "a1b2c3d4e5f6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("book_photos", sa.Column("thumbnail_url", sa.Text, nullable=True))


def downgrade() -> None:
    op.drop_column("book_photos", "thumbnail_url")
