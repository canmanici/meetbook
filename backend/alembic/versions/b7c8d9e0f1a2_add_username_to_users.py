"""add username to users

Revision ID: b7c8d9e0f1a2
Revises: a2f66e640f46
Create Date: 2026-07-03 00:00:00.000000

"""

import re
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "b7c8d9e0f1a2"
down_revision: str | None = "a2f66e640f46"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("users", sa.Column("username", sa.String(length=30), nullable=True))

    # Backfill existing users with a slug derived from their email local-part,
    # de-duplicated with a numeric suffix, so the column can become NOT NULL + UNIQUE.
    conn = op.get_bind()
    rows = conn.execute(sa.text("SELECT id, email FROM users ORDER BY created_at")).fetchall()
    seen: set[str] = set()
    for row in rows:
        base = re.sub(r"[^a-z0-9_]", "", row.email.split("@")[0].lower())[:26] or "user"
        candidate = base
        suffix = 1
        while candidate in seen:
            suffix += 1
            candidate = f"{base}{suffix}"[:30]
        seen.add(candidate)
        conn.execute(
            sa.text("UPDATE users SET username = :username WHERE id = :id"),
            {"username": candidate, "id": row.id},
        )

    op.alter_column("users", "username", nullable=False)
    op.create_unique_constraint("uq_users_username", "users", ["username"])


def downgrade() -> None:
    op.drop_constraint("uq_users_username", "users", type_="unique")
    op.drop_column("users", "username")
