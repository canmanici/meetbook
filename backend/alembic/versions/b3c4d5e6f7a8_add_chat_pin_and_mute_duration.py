"""add chat pin and mute duration columns

Adds is_pinned, pinned_at, muted_until to chat_settings (per-user per-chat).
- B14: Chat Pinning — is_pinned + pinned_at
- B15: Mute Duration — muted_until (NULL = forever when is_muted is true)

Revision ID: b3c4d5e6f7a8
Revises: c8f9b2fc15d9
Create Date: 2026-07-01 12:00:00.000000

"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "b3c4d5e6f7a8"
down_revision: str | None = "c8f9b2fc15d9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "chat_settings",
        sa.Column("is_pinned", sa.Boolean(), nullable=False, server_default="false"),
    )
    op.add_column(
        "chat_settings",
        sa.Column("pinned_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "chat_settings",
        sa.Column("muted_until", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("chat_settings", "muted_until")
    op.drop_column("chat_settings", "pinned_at")
    op.drop_column("chat_settings", "is_pinned")
