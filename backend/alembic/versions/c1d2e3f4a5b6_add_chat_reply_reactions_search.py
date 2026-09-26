"""add chat reply reactions search

Revision ID: a1b2c3d4e5f6
Revises: c3d4e5f6a7b8
Create Date: 2026-06-20 00:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

# revision identifiers, used by Alembic.
revision: str = "c1d2e3f4a5b6"
down_revision: Union[str, None] = "e1f2a3b4c5d6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add reply_to_id column to messages
    op.add_column(
        "messages",
        sa.Column(
            "reply_to_id",
            UUID(as_uuid=True),
            sa.ForeignKey("messages.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index("ix_messages_reply_to_id", "messages", ["reply_to_id"])

    # Add deleted_by column to messages
    op.add_column(
        "messages",
        sa.Column("deleted_by", UUID(as_uuid=True), nullable=True),
    )

    # Create message_reactions table
    op.create_table(
        "message_reactions",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "message_id",
            UUID(as_uuid=True),
            sa.ForeignKey("messages.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("emoji", sa.Text(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.UniqueConstraint("message_id", "user_id", "emoji", name="uq_reaction_per_user_emoji"),
    )
    op.create_index("ix_message_reactions_message_id", "message_reactions", ["message_id"])


def downgrade() -> None:
    op.drop_table("message_reactions")
    op.drop_index("ix_messages_reply_to_id", "messages")
    op.drop_column("messages", "deleted_by")
    op.drop_column("messages", "reply_to_id")
