"""refresh_tokens: client IP, user agent and device/network snapshot

Revision ID: a3c7e9f1b2d4
Revises: 881192201581
Create Date: 2026-09-26
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "a3c7e9f1b2d4"
down_revision: str | None = "881192201581"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("refresh_tokens", sa.Column("ip_address", postgresql.INET(), nullable=True))
    op.add_column("refresh_tokens", sa.Column("user_agent", sa.Text(), nullable=True))
    op.add_column(
        "refresh_tokens",
        sa.Column("client", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )
    op.create_index("ix_audit_log_created_at", "audit_log", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_audit_log_created_at", table_name="audit_log")
    op.drop_column("refresh_tokens", "client")
    op.drop_column("refresh_tokens", "user_agent")
    op.drop_column("refresh_tokens", "ip_address")
