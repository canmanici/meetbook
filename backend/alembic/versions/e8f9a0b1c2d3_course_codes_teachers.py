"""course codes on books + teacher applications

Revision ID: e8f9a0b1c2d3
Revises: d7e8f9a0b1c2
Create Date: 2026-09-29
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "e8f9a0b1c2d3"
down_revision: str | None = "d7e8f9a0b1c2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("books", sa.Column("course_code", sa.Text(), nullable=True))
    op.add_column("books", sa.Column("instructor", sa.Text(), nullable=True))
    op.create_index(
        "ix_books_course_code",
        "books",
        ["course_code"],
        postgresql_where=sa.text("course_code IS NOT NULL AND deleted_at IS NULL"),
    )

    op.add_column(
        "users", sa.Column("teacher_verified_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column("users", sa.Column("teacher_institution", sa.String(200), nullable=True))

    status = postgresql.ENUM(
        "pending",
        "approved",
        "rejected",
        "revoked",
        name="teacher_application_status",
        create_type=False,
    )
    status.create(op.get_bind(), checkfirst=True)
    op.create_table(
        "teacher_applications",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("institution", sa.String(200), nullable=False),
        sa.Column("department", sa.String(200), nullable=True),
        sa.Column("work_email", sa.String(255), nullable=True),
        sa.Column("profile_url", sa.String(500), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("status", status, nullable=False),
        sa.Column("review_note", sa.Text(), nullable=True),
        sa.Column(
            "reviewed_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_teacher_applications_status_created",
        "teacher_applications",
        ["status", "created_at"],
    )
    op.create_index(
        "uq_teacher_applications_open",
        "teacher_applications",
        ["user_id"],
        unique=True,
        postgresql_where=sa.text("status IN ('pending', 'approved')"),
    )


def downgrade() -> None:
    op.drop_table("teacher_applications")
    postgresql.ENUM(name="teacher_application_status").drop(op.get_bind(), checkfirst=True)
    op.drop_column("users", "teacher_institution")
    op.drop_column("users", "teacher_verified_at")
    op.drop_index("ix_books_course_code", table_name="books")
    op.drop_column("books", "instructor")
    op.drop_column("books", "course_code")
