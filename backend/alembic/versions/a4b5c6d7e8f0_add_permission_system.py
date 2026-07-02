"""add permission/role/beta-request tables + audit_log enrichment

Revision ID: a4b5c6d7e8f0
Revises: f4a5b6c7d8e9
Create Date: 2026-07-01 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "a4b5c6d7e8f0"
down_revision: str | None = "f4a5b6c7d8e9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ── permissions ──────────────────────────────────────────────
    op.create_table(
        "permissions",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("codename", sa.String(100), nullable=False),
        sa.Column("label", sa.String(200), nullable=False),
        sa.Column("group", sa.String(50), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_permissions_codename", "permissions", ["codename"], unique=True)

    # ── roles ────────────────────────────────────────────────────
    op.create_table(
        "roles",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("name", sa.String(50), nullable=False),
        sa.Column("label", sa.String(100), nullable=False),
        sa.Column("level", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("color", sa.String(7), nullable=False, server_default="#6b7280"),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("is_system", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("created_by", sa.UUID(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], name="fk_roles_created_by"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_roles_name", "roles", ["name"], unique=True)

    # ── role_permissions ─────────────────────────────────────────
    op.create_table(
        "role_permissions",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("role_id", sa.UUID(), nullable=False),
        sa.Column("permission_id", sa.UUID(), nullable=False),
        sa.Column("granted_by", sa.UUID(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["role_id"], ["roles.id"], ondelete="CASCADE", name="fk_rp_role"),
        sa.ForeignKeyConstraint(["permission_id"], ["permissions.id"], ondelete="CASCADE", name="fk_rp_permission"),
        sa.ForeignKeyConstraint(["granted_by"], ["users.id"], name="fk_rp_granted_by"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("role_id", "permission_id", name="uq_role_permission"),
    )

    # ── user_roles ───────────────────────────────────────────────
    op.create_table(
        "user_roles",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("role_id", sa.UUID(), nullable=False),
        sa.Column("granted_by", sa.UUID(), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE", name="fk_ur_user"),
        sa.ForeignKeyConstraint(["role_id"], ["roles.id"], ondelete="CASCADE", name="fk_ur_role"),
        sa.ForeignKeyConstraint(["granted_by"], ["users.id"], name="fk_ur_granted_by"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "role_id", name="uq_user_role"),
    )

    # ── beta_requests ────────────────────────────────────────────
    op.create_table(
        "beta_requests",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("status", sa.Enum("pending", "approved", "rejected", name="beta_request_status", create_type=True), nullable=False, server_default="pending"),
        sa.Column("reviewed_by", sa.UUID(), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("rejection_reason", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE", name="fk_br_user"),
        sa.ForeignKeyConstraint(["reviewed_by"], ["users.id"], name="fk_br_reviewer"),
        sa.PrimaryKeyConstraint("id"),
    )

    # ── audit_log enrichment ─────────────────────────────────────
    # target_type, target_id, target_email, details (all nullable)
    op.add_column("audit_log", sa.Column("target_type", sa.String(50), nullable=True))
    op.add_column("audit_log", sa.Column("target_id", sa.UUID(), nullable=True))
    op.add_column("audit_log", sa.Column("target_email", sa.String(255), nullable=True))
    op.add_column("audit_log", sa.Column("details", postgresql.JSONB(), nullable=True))

    # note: notification_settings and auto_accept_rules were already
    # added to users in migration f4a5b6c7d8e9 — skipping.


def downgrade() -> None:
    # reverse audit_log enrichment
    op.drop_column("audit_log", "details")
    op.drop_column("audit_log", "target_email")
    op.drop_column("audit_log", "target_id")
    op.drop_column("audit_log", "target_type")

    # reverse beta_requests
    op.drop_table("beta_requests")
    op.execute("DROP TYPE IF EXISTS beta_request_status")

    # reverse user_roles
    op.drop_table("user_roles")

    # reverse role_permissions
    op.drop_table("role_permissions")

    # reverse roles
    op.drop_index("ix_roles_name", table_name="roles")
    op.drop_table("roles")

    # reverse permissions
    op.drop_index("ix_permissions_codename", table_name="permissions")
    op.drop_table("permissions")
