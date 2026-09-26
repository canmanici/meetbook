"""app release withdraw + minimum supported version policy

Revision ID: 881192201581
Revises: fc573ca5f0e0
Create Date: 2026-09-26 05:00:00.000000

"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = '881192201581'
down_revision: str | None = 'fc573ca5f0e0'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column('app_releases', sa.Column('withdrawn_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('app_releases', sa.Column('withdrawn_reason', sa.Text(), nullable=True))
    op.create_table(
        'app_update_policies',
        sa.Column('platform', sa.String(10), primary_key=True),
        sa.Column('min_supported_code', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('message', sa.Text(), nullable=True),
        sa.Column('updated_by', sa.UUID(), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table('app_update_policies')
    op.drop_column('app_releases', 'withdrawn_reason')
    op.drop_column('app_releases', 'withdrawn_at')
