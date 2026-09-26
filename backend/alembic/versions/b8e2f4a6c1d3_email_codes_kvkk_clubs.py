"""email_codes, data_subject_requests, clubs / club_members / club_messages

Revision ID: b8e2f4a6c1d3
Revises: a7d1e2f3c4b5
Create Date: 2026-09-26 12:00:00.000000

"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "b8e2f4a6c1d3"
down_revision: str | None = "a7d1e2f3c4b5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "email_codes",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column(
            "user_id", sa.UUID(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("purpose", sa.String(20), nullable=False),
        sa.Column("code_hash", sa.String(64), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_email_codes_user_purpose", "email_codes", ["user_id", "purpose"])

    op.create_table(
        "data_subject_requests",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("reference", sa.String(12), nullable=False, unique=True),
        sa.Column("full_name", sa.String(200), nullable=False),
        sa.Column("email", sa.String(320), nullable=False),
        sa.Column("phone", sa.String(20), nullable=True),
        sa.Column("username", sa.String(100), nullable=False),
        sa.Column("request_type", sa.String(100), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("extra_info", sa.Text(), nullable=True),
        sa.Column("identity_method", sa.String(100), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="open"),
        sa.Column("admin_notes", sa.Text(), nullable=True),
        sa.Column(
            "handled_by", sa.UUID(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("due_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_data_subject_requests_status", "data_subject_requests", ["status"])

    op.create_table(
        "clubs",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("name", sa.String(60), nullable=False),
        sa.Column(
            "owner_id", sa.UUID(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("shuffled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "club_members",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column(
            "club_id", sa.UUID(), sa.ForeignKey("clubs.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column(
            "user_id", sa.UUID(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("status", sa.String(10), nullable=False, server_default="invited"),
        sa.Column(
            "book_id", sa.UUID(), sa.ForeignKey("books.id", ondelete="SET NULL"), nullable=True
        ),
        sa.Column(
            "receives_from_user_id",
            sa.UUID(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "invited_by", sa.UUID(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True
        ),
        sa.Column("joined_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("club_id", "user_id", name="uq_club_members_club_user"),
    )
    op.create_index("ix_club_members_user_id", "club_members", ["user_id"])
    op.create_table(
        "club_messages",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column(
            "club_id", sa.UUID(), sa.ForeignKey("clubs.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column(
            "sender_id", sa.UUID(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True
        ),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_club_messages_club_created", "club_messages", ["club_id", "created_at"])


def downgrade() -> None:
    op.drop_table("club_messages")
    op.drop_table("club_members")
    op.drop_table("clubs")
    op.drop_table("data_subject_requests")
    op.drop_table("email_codes")
