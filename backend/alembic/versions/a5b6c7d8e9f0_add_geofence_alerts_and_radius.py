"""add geofence_alerts table and users.geofence_radius_km

Revision ID: a5b6c7d8e9f0
Revises: d1e2f3a4b5c6
Create Date: 2026-06-21 14:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision: str = "a5b6c7d8e9f0"
down_revision: Union[str, None] = "d1e2f3a4b5c6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "geofence_alerts",
        sa.Column(
            "id", UUID(as_uuid=True), primary_key=True, server_default=sa.func.gen_random_uuid()
        ),
        sa.Column(
            "user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "wishlist_item_id",
            UUID(as_uuid=True),
            sa.ForeignKey("wishlist_items.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "book_id",
            UUID(as_uuid=True),
            sa.ForeignKey("books.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint(
            "user_id", "wishlist_item_id", "book_id", name="uq_geofence_alert_idempotent"
        ),
    )
    op.create_index(
        "idx_geofence_alerts_user_unread",
        "geofence_alerts",
        ["user_id"],
        postgresql_where=sa.text("read_at IS NULL"),
    )

    op.add_column(
        "users",
        sa.Column("geofence_radius_km", sa.Integer(), nullable=False, server_default="10"),
    )
    op.create_check_constraint(
        "ck_users_geofence_radius_range",
        "users",
        "geofence_radius_km BETWEEN 1 AND 100",
    )


def downgrade() -> None:
    op.drop_constraint("ck_users_geofence_radius_range", "users", type_="check")
    op.drop_column("users", "geofence_radius_km")
    op.drop_index("idx_geofence_alerts_user_unread", table_name="geofence_alerts")
    op.drop_table("geofence_alerts")
