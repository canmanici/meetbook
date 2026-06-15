"""add ratings, reports, notifications, admin flag and rating aggregates

Revision ID: b8c9d0e1f2a3
Revises: a7b8c9d0e1f2
Create Date: 2026-06-14 00:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = 'b8c9d0e1f2a3'
down_revision: str | None = 'a7b8c9d0e1f2'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        'users',
        sa.Column('rating_average', sa.Numeric(3, 2), nullable=False, server_default='0'),
    )
    op.add_column(
        'users',
        sa.Column('rating_count', sa.Integer(), nullable=False, server_default='0'),
    )
    op.add_column(
        'users',
        sa.Column('is_admin', sa.Boolean(), nullable=False, server_default='false'),
    )

    report_target = postgresql.ENUM(
        'user', 'book', 'message', 'place', name='report_target', create_type=False
    )
    report_status = postgresql.ENUM(
        'open', 'reviewing', 'resolved', 'dismissed', name='report_status', create_type=False
    )
    report_target.create(op.get_bind(), checkfirst=True)
    report_status.create(op.get_bind(), checkfirst=True)

    op.create_table(
        'ratings',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            'exchange_request_id',
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey('exchange_requests.id', ondelete='CASCADE'),
            nullable=False,
        ),
        sa.Column(
            'rated_by', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id'), nullable=False
        ),
        sa.Column(
            'rated_user', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id'), nullable=False
        ),
        sa.Column('score', sa.Integer(), nullable=False),
        sa.Column('comment', sa.Text(), nullable=True),
        sa.Column('revealed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint('score >= 1 AND score <= 5', name='ck_ratings_score_range'),
        sa.UniqueConstraint('exchange_request_id', 'rated_by', name='uq_ratings_exchange_rater'),
    )
    op.create_index('ix_ratings_rated_user', 'ratings', ['rated_user'])
    op.create_index('ix_ratings_exchange_request_id', 'ratings', ['exchange_request_id'])

    op.create_table(
        'reports',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            'reporter_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id'), nullable=False
        ),
        sa.Column('target_type', report_target, nullable=False),
        sa.Column('target_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('reason', sa.Text(), nullable=False),
        sa.Column('content_snapshot', postgresql.JSONB, nullable=False, server_default='{}'),
        sa.Column('status', report_status, nullable=False, server_default='open'),
        sa.Column(
            'moderator_id',
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey('users.id'),
            nullable=True,
        ),
        sa.Column('moderator_notes', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('resolved_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index('ix_reports_status', 'reports', ['status'])
    op.create_index('ix_reports_reporter_id', 'reports', ['reporter_id'])

    op.create_table(
        'notifications',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            'user_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id'), nullable=False
        ),
        sa.Column('type', sa.Text(), nullable=False),
        sa.Column('payload', postgresql.JSONB, nullable=False, server_default='{}'),
        sa.Column('read_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index('ix_notifications_user_id', 'notifications', ['user_id'])


def downgrade() -> None:
    op.drop_index('ix_notifications_user_id', table_name='notifications')
    op.drop_table('notifications')

    op.drop_index('ix_reports_reporter_id', table_name='reports')
    op.drop_index('ix_reports_status', table_name='reports')
    op.drop_table('reports')

    op.drop_index('ix_ratings_exchange_request_id', table_name='ratings')
    op.drop_index('ix_ratings_rated_user', table_name='ratings')
    op.drop_table('ratings')

    postgresql.ENUM(name='report_status').drop(op.get_bind(), checkfirst=True)
    postgresql.ENUM(name='report_target').drop(op.get_bind(), checkfirst=True)

    op.drop_column('users', 'is_admin')
    op.drop_column('users', 'rating_count')
    op.drop_column('users', 'rating_average')
