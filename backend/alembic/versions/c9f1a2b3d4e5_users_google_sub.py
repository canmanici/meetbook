"""users.google_sub for Sign in with Google

Revision ID: c9f1a2b3d4e5
Revises: b8e2f4a6c1d3
Create Date: 2026-09-26 03:00:00.000000

"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = 'c9f1a2b3d4e5'
down_revision: str | None = 'b8e2f4a6c1d3'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column('users', sa.Column('google_sub', sa.String(255), nullable=True))
    op.create_unique_constraint('uq_users_google_sub', 'users', ['google_sub'])


def downgrade() -> None:
    op.drop_constraint('uq_users_google_sub', 'users', type_='unique')
    op.drop_column('users', 'google_sub')
