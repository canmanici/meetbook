"""app_releases — self-hosted APK updates

Revision ID: fc573ca5f0e0
Revises: c9f1a2b3d4e5
Create Date: 2026-09-26 04:00:00.000000

"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "fc573ca5f0e0"
down_revision: str | None = "c9f1a2b3d4e5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "app_releases",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("platform", sa.String(10), nullable=False, server_default="android"),
        sa.Column("version_code", sa.Integer(), nullable=False),
        sa.Column("version_name", sa.String(30), nullable=False),
        sa.Column("storage_key", sa.Text(), nullable=False),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("sha256", sa.String(64), nullable=False),
        sa.Column("md5", sa.String(32), nullable=False),
        sa.Column("changelog", sa.Text(), nullable=True),
        sa.Column("mandatory", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column(
            "uploaded_by", sa.UUID(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("platform", "version_code", name="uq_app_releases_platform_code"),
    )


def downgrade() -> None:
    op.drop_table("app_releases")
