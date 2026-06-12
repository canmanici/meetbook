"""add kvkk consent columns

Revision ID: f3a91c2e7d4b
Revises: 331adac8bfab
Create Date: 2026-06-12 00:00:00.000000

"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = 'f3a91c2e7d4b'
down_revision: str | None = '331adac8bfab'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        'users',
        sa.Column(
            'kvkk_consent_at',
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.add_column(
        'users',
        sa.Column(
            'kvkk_policy_version',
            sa.String(20),
            nullable=False,
            server_default='1.0',
        ),
    )


def downgrade() -> None:
    op.drop_column('users', 'kvkk_policy_version')
    op.drop_column('users', 'kvkk_consent_at')
