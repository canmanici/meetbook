"""add books table

Revision ID: 7b2c4f1a9e6d
Revises: f3a91c2e7d4b
Create Date: 2026-06-12 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from geoalchemy2 import Geography
from sqlalchemy.dialects import postgresql

revision: str = "7b2c4f1a9e6d"
down_revision: str | None = "f3a91c2e7d4b"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        "CREATE TYPE book_category AS ENUM "
        "('fiction', 'non_fiction', 'textbook', 'children', 'comics', 'poetry', 'other')"
    )
    op.execute("CREATE TYPE book_condition AS ENUM ('new', 'like_new', 'good', 'worn')")

    op.create_table(
        "books",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "owner_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False
        ),
        sa.Column("title", sa.Text, nullable=False),
        sa.Column("author", sa.Text, nullable=True),
        sa.Column("isbn", sa.Text, nullable=True),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column(
            "category",
            postgresql.ENUM(
                "fiction",
                "non_fiction",
                "textbook",
                "children",
                "comics",
                "poetry",
                "other",
                name="book_category",
                create_type=False,
            ),
            nullable=False,
        ),
        sa.Column("language", sa.Text, nullable=False, server_default="tr"),
        sa.Column(
            "condition",
            postgresql.ENUM(
                "new", "like_new", "good", "worn", name="book_condition", create_type=False
            ),
            nullable=False,
        ),
        sa.Column("is_available", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("location", Geography(geometry_type="POINT", srid=4326), nullable=False),
        sa.Column("public_location", Geography(geometry_type="POINT", srid=4326), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    )
    op.create_index("ix_books_owner_id", "books", ["owner_id"])
    op.create_index("ix_books_location", "books", ["location"], postgresql_using="gist")
    op.create_index(
        "ix_books_public_location", "books", ["public_location"], postgresql_using="gist"
    )


def downgrade() -> None:
    op.drop_index("ix_books_public_location", table_name="books")
    op.drop_index("ix_books_location", table_name="books")
    op.drop_index("ix_books_owner_id", table_name="books")
    op.drop_table("books")
    op.execute("DROP TYPE IF EXISTS book_condition")
    op.execute("DROP TYPE IF EXISTS book_category")
