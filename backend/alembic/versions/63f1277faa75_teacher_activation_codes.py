"""teacher activation codes (admin e-mails them to the work address)

Revision ID: 63f1277faa75
Revises: f9a0b1c2d3e4
Create Date: 2026-09-29
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "63f1277faa75"
down_revision: str | None = "f9a0b1c2d3e4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "teacher_applications", sa.Column("activation_code_hash", sa.String(64), nullable=True)
    )
    op.add_column(
        "teacher_applications",
        sa.Column("activation_expires_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "teacher_applications",
        sa.Column("activation_attempts", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "teacher_applications",
        sa.Column(
            "activation_issued_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )


def downgrade() -> None:
    for column in (
        "activation_issued_by",
        "activation_attempts",
        "activation_expires_at",
        "activation_code_hash",
    ):
        op.drop_column("teacher_applications", column)
