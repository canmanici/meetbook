"""add meetup module

Revision ID: d4e5f6a7b8c9
Revises: c3d4e5f6a7b8
Create Date: 2026-06-13 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

from app.core.geo import TURKEY_BOUNDARY_WKT

revision: str = "d4e5f6a7b8c9"
down_revision: str | None = "c3d4e5f6a7b8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("CREATE TYPE meetup_validation_status AS ENUM ('auto', 'warning', 'rejected')")

    op.add_column("users", sa.Column("trusted_contact_name", sa.String(100), nullable=True))
    op.add_column("users", sa.Column("trusted_contact_phone", sa.String(20), nullable=True))

    op.create_table(
        "meetups",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "exchange_request_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("exchange_requests.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column("place_id", sa.Text, nullable=True),
        sa.Column("place_name", sa.Text, nullable=False),
        sa.Column("address", sa.Text, nullable=True),
        sa.Column("category", sa.Text, nullable=True),
        sa.Column("lat", sa.Double, nullable=False),
        sa.Column("lng", sa.Double, nullable=False),
        sa.Column(
            "validation_status",
            postgresql.ENUM(
                "auto",
                "warning",
                "rejected",
                name="meetup_validation_status",
                create_type=False,
            ),
            nullable=False,
        ),
        sa.Column("scheduled_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "proposed_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False
        ),
        sa.Column("proposer_acknowledged", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("other_acknowledged", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    )
    op.execute("ALTER TABLE meetups ADD COLUMN geom geography(Point,4326) NOT NULL")
    op.create_index("ix_meetups_geom", "meetups", ["geom"], postgresql_using="gist")

    op.create_table(
        "blocked_places",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("place_id", sa.Text, nullable=True),
        sa.Column("lat", sa.Double, nullable=False),
        sa.Column("lng", sa.Double, nullable=False),
        sa.Column("reason", sa.Text, nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    )
    op.execute("ALTER TABLE blocked_places ADD COLUMN geom geography(Point,4326) NOT NULL")
    op.create_index("ix_blocked_places_geom", "blocked_places", ["geom"], postgresql_using="gist")

    op.create_table(
        "country_boundaries",
        sa.Column("name", sa.Text, primary_key=True),
    )
    op.execute("ALTER TABLE country_boundaries ADD COLUMN geom geography(Polygon,4326) NOT NULL")
    # TURKEY_BOUNDARY_WKT is a hardcoded module constant, not user input.
    op.execute(
        f"INSERT INTO country_boundaries (name, geom) VALUES "  # noqa: S608
        f"('turkey', ST_GeogFromText('SRID=4326;{TURKEY_BOUNDARY_WKT}'))"
    )


def downgrade() -> None:
    op.drop_table("country_boundaries")
    op.drop_index("ix_blocked_places_geom", table_name="blocked_places")
    op.drop_table("blocked_places")
    op.drop_index("ix_meetups_geom", table_name="meetups")
    op.drop_table("meetups")
    op.drop_column("users", "trusted_contact_phone")
    op.drop_column("users", "trusted_contact_name")
    op.execute("DROP TYPE meetup_validation_status")
