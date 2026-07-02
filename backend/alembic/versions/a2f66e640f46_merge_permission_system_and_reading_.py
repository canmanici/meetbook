"""merge permission system and reading buddies heads

Revision ID: a2f66e640f46
Revises: a4b5c6d7e8f0, e2a3b4c5d6e7
Create Date: 2026-07-02 08:52:55.055297

"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = 'a2f66e640f46'
down_revision: str | None = ('a4b5c6d7e8f0', 'e2a3b4c5d6e7')
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
