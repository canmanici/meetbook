"""add avatar_url to users

Revision ID: c8f9b2fc15d9
Revises: 4bbb23e76773
Create Date: 2026-06-27 01:12:14.059408

"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "c8f9b2fc15d9"
down_revision: str | None = "4bbb23e76773"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("users", sa.Column("avatar_url", sa.String(500), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "avatar_url")
