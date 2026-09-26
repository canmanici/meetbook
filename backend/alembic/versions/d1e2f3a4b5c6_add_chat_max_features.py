"""add chat max features — message_type, star, pin, settings, presence, link_preview

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
Create Date: 2026-06-20 12:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB

# revision identifiers, used by Alembic.
revision: str = "d1e2f3a4b5c6"
down_revision: Union[str, None] = "c1d2e3f4a5b6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── messages table additions ──────────────────────────────────────────
    op.add_column(
        "messages", sa.Column("message_type", sa.Text(), nullable=False, server_default="text")
    )
    op.add_column("messages", sa.Column("extra", JSONB(), nullable=True))
    op.add_column("messages", sa.Column("starred_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("messages", sa.Column("pinned_at", sa.DateTime(timezone=True), nullable=True))

    # Make sender_id nullable for system messages
    op.alter_column("messages", "sender_id", nullable=True)

    # ── chat_settings table ───────────────────────────────────────────────
    op.create_table(
        "chat_settings",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "chat_id",
            UUID(as_uuid=True),
            sa.ForeignKey("chats.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("is_muted", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("wallpaper_url", sa.Text(), nullable=True),
        sa.Column("font_size", sa.Text(), nullable=True, server_default="normal"),
        sa.Column("notification_sound", sa.Text(), nullable=True, server_default="default"),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.UniqueConstraint("chat_id", "user_id", name="uq_chat_settings_per_user"),
    )

    # ── link_previews table ───────────────────────────────────────────────
    op.create_table(
        "link_previews",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("url", sa.Text(), nullable=False, unique=True),
        sa.Column("title", sa.Text(), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("image_url", sa.Text(), nullable=True),
        sa.Column("site_name", sa.Text(), nullable=True),
        sa.Column(
            "fetched_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    )


def downgrade() -> None:
    op.drop_table("link_previews")
    op.drop_table("chat_settings")
    op.drop_column("messages", "pinned_at")
    op.drop_column("messages", "starred_at")
    op.drop_column("messages", "extra")
    op.drop_column("messages", "message_type")
    op.alter_column("messages", "sender_id", nullable=False)
