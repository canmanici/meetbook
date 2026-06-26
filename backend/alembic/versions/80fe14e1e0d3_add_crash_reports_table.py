"""add crash_reports table

Revision ID: 80fe14e1e0d3
Revises: e6f7a8b9c0d1
Create Date: 2026-06-27 00:12:09.714758

"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = '80fe14e1e0d3'
down_revision: str | None = 'e6f7a8b9c0d1'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table('crash_reports',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('app', sa.String(length=20), nullable=False, comment='mobile | backend | admin'),
    sa.Column('app_version', sa.String(length=30), nullable=True, comment='e.g. 1.1.0'),
    sa.Column('error_type', sa.String(length=100), nullable=True, comment='Error.name e.g. TypeError'),
    sa.Column('error_message', sa.Text(), nullable=False, comment='Human-readable error description'),
    sa.Column('stack_trace', sa.Text(), nullable=True, comment='Full JS/Python stack trace'),
    sa.Column('breadcrumbs', postgresql.JSONB(astext_type=sa.Text()), nullable=False, comment='Last N user actions before crash'),
    sa.Column('device_info', postgresql.JSONB(astext_type=sa.Text()), nullable=False, comment='{ platform, os_version, model, memory_mb, ... }'),
    sa.Column('screen_name', sa.String(length=100), nullable=True, comment='Screen the user was on'),
    sa.Column('user_id', sa.UUID(), nullable=True, comment='Logged-in user (if any)'),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, comment='When the crash was reported'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id')
    )


def downgrade() -> None:
    op.drop_table('crash_reports')
