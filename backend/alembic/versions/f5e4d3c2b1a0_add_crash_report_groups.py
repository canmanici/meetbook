"""add crash_report_groups table + group_id to crash_reports

Revision ID: f5e4d3c2b1a0
Revises: b7c8d9e0f1a2
Create Date: 2026-07-04 12:00:00.000000

"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = 'f5e4d3c2b1a0'
down_revision: str | None = 'b7c8d9e0f1a2'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ── crash_report_groups table ──────────────────────────────────────────
    op.create_table('crash_report_groups',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('group_hash', sa.String(length=64), nullable=False, comment='SHA256(error_type + :: + normalized stack prefix)'),
        sa.Column('error_type', sa.String(length=100), nullable=True, comment='Error.name e.g. TypeError'),
        sa.Column('error_message', sa.Text(), nullable=True, comment='Most common error message'),
        sa.Column('stack_trace', sa.Text(), nullable=True, comment='Latest full stack trace'),

        # Status workflow
        sa.Column('status', sa.String(length=20), nullable=False, server_default='new', comment='new | investigating | fixed | closed'),
        sa.Column('severity', sa.String(length=10), nullable=False, server_default='error', comment='fatal | error | warning'),

        # Counts
        sa.Column('occurrence_count', sa.Integer(), nullable=False, server_default='1', comment='Total times seen'),
        sa.Column('affected_users', sa.Integer(), nullable=False, server_default='0', comment='Distinct affected user IDs'),

        # Time
        sa.Column('first_seen', sa.DateTime(timezone=True), nullable=False, comment='When first crash in group occurred'),
        sa.Column('last_seen', sa.DateTime(timezone=True), nullable=False, comment='When most recent crash occurred'),

        # Version tracking
        sa.Column('first_seen_version', sa.String(length=30), nullable=True, comment='App version when first seen'),
        sa.Column('fixed_in_version', sa.String(length=30), nullable=True, comment='App version that fixed this'),
        sa.Column('affected_versions', postgresql.JSONB(astext_type=sa.Text()), nullable=True, comment='{ version: count, ... }'),

        # Admin actions
        sa.Column('assignee_id', sa.UUID(), nullable=True, comment='Admin investigating this group'),
        sa.Column('notes', sa.Text(), nullable=True, comment='Admin notes'),

        # Reference to a sample crash
        sa.Column('sample_crash_id', sa.UUID(), nullable=True, comment='Latest crash ID in this group'),

        # Device stats
        sa.Column('top_platforms', postgresql.JSONB(astext_type=sa.Text()), nullable=True, comment='{ platform: count, ... }'),
        sa.Column('top_screens', postgresql.JSONB(astext_type=sa.Text()), nullable=True, comment='{ screen: count, ... }'),

        # Timestamps
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),

        sa.ForeignKeyConstraint(['assignee_id'], ['users.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['sample_crash_id'], ['crash_reports.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_crash_report_groups_group_hash', 'crash_report_groups', ['group_hash'], unique=True)
    op.create_index('ix_crash_report_groups_status', 'crash_report_groups', ['status'])
    op.create_index('ix_crash_report_groups_severity', 'crash_report_groups', ['severity'])

    # ── Add group_id to crash_reports ──────────────────────────────────────
    op.add_column('crash_reports',
        sa.Column('group_id', sa.UUID(), nullable=True, comment='FK to grouped crash fingerprint')
    )
    op.create_index('ix_crash_reports_group_id', 'crash_reports', ['group_id'])
    op.create_foreign_key(
        'fk_crash_reports_group_id',
        'crash_reports', 'crash_report_groups',
        ['group_id'], ['id'],
        ondelete='SET NULL',
    )


def downgrade() -> None:
    op.drop_constraint('fk_crash_reports_group_id', 'crash_reports', type_='foreignkey')
    op.drop_index('ix_crash_reports_group_id', table_name='crash_reports')
    op.drop_column('crash_reports', 'group_id')
    op.drop_index('ix_crash_report_groups_severity', table_name='crash_report_groups')
    op.drop_index('ix_crash_report_groups_status', table_name='crash_report_groups')
    op.drop_index('ix_crash_report_groups_group_hash', table_name='crash_report_groups')
    op.drop_table('crash_report_groups')
