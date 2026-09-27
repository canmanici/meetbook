"""perf: hot-path indexes (chat list, notifications, ISBN) + drop duplicate GiST

- messages(chat_id, created_at DESC, id DESC): latest-message lookup per chat
  and the keyset-paginated message list (ORDER BY created_at DESC, id DESC).
  Supersedes ix_messages_chat_id_created_at.
- messages(chat_id) WHERE read_at IS NULL AND deleted_at IS NULL: unread
  badge counts in the chat list touch only unread rows.
- notifications(user_id, created_at DESC) + partial (user_id) WHERE read_at
  IS NULL. Supersedes ix_notifications_user_id.
- books(isbn): wishlist / geofence / twin matching look books up by ISBN.
- idx_books_location / idx_books_public_location were auto-created by
  GeoAlchemy2 (spatial_index=True) next to the explicit ix_books_* GiST
  indexes — exact duplicates that only cost writes and RAM.

Indexes are built CONCURRENTLY so a deploy never blocks writes.

Revision ID: b7e1d2c3f4a5
Revises: a3c7e9f1b2d4
Create Date: 2026-09-27
"""

from collections.abc import Sequence

from alembic import op

revision: str = "b7e1d2c3f4a5"
down_revision: str | None = "a3c7e9f1b2d4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


_CREATE = [
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_messages_chat_created_id "
    "ON messages (chat_id, created_at DESC, id DESC)",
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_messages_chat_unread "
    "ON messages (chat_id) WHERE read_at IS NULL AND deleted_at IS NULL",
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_notifications_user_created "
    "ON notifications (user_id, created_at DESC)",
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_notifications_user_unread "
    "ON notifications (user_id) WHERE read_at IS NULL",
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_books_isbn ON books (isbn) WHERE isbn IS NOT NULL",
]

_DROP_SUPERSEDED = [
    "DROP INDEX CONCURRENTLY IF EXISTS ix_messages_chat_id_created_at",
    "DROP INDEX CONCURRENTLY IF EXISTS ix_notifications_user_id",
    "DROP INDEX CONCURRENTLY IF EXISTS idx_books_location",
    "DROP INDEX CONCURRENTLY IF EXISTS idx_books_public_location",
]


def upgrade() -> None:
    with op.get_context().autocommit_block():
        for sql in _CREATE + _DROP_SUPERSEDED:
            op.execute(sql)


def downgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_messages_chat_id_created_at "
            "ON messages (chat_id, created_at)"
        )
        op.execute(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_notifications_user_id "
            "ON notifications (user_id)"
        )
        for name in (
            "ix_messages_chat_created_id",
            "ix_messages_chat_unread",
            "ix_notifications_user_created",
            "ix_notifications_user_unread",
            "ix_books_isbn",
        ):
            op.execute(f"DROP INDEX CONCURRENTLY IF EXISTS {name}")
