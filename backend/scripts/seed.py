#!/usr/bin/env python3
"""Idempotent seed script for MeetBook.

Runs after migrations. Creates initial data that every environment needs.
Designed to be safe to run multiple times — uses INSERT ... ON CONFLICT for
every operation so it never duplicates data.

Usage:
    PYTHONPATH=/app uv run python scripts/seed.py

Environment variables:
    ENV=development   → seeds dev users + demo data
    ENV=production    → seeds only essentials (admin user, categories)
    SKIP_SEED=1       → skip entirely

  Production admin (set in Dokploy env, never in the repo):
    SEED_ADMIN_EMAIL     → bootstrap admin account (default admin@meetbook.app)
    SEED_ADMIN_PASSWORD  → its password. Empty in production = the account is
                           NOT created. When set, an existing account's
                           password is re-synced to it on every boot — change
                           the env var + redeploy to rotate it.
    ADMIN_EMAILS         → comma-separated EXISTING accounts to give admin
                           rights (e.g. your own registered account).
"""

import asyncio
import os
import sys
from datetime import datetime, timezone

from typing import Any

from sqlalchemy import func, select, update

from app.core.config import get_settings
from app.core.db import Base, get_engine, get_session_factory

# ── Seed Data ────────────────────────────────────────────────────────────────

# Bootstrap admin — created only when SEED_ADMIN_PASSWORD is set (dev and
# prod alike). No password ever lives in this public repo.
BOOTSTRAP_ADMIN = {
    "email": "admin@meetbook.app",
    "name": "Admin",
    "username": "admin",
    "is_admin": True,
    "status": "active",
}

DEV_USERS = [
    {
        "email": "demo@meetbook.app",
        "name": "Demo User",
        "username": "demo",
        "password": "changeme123",
        "is_admin": False,
        "status": "active",
    },
]

DEMO_BOOKS = [
    {
        "isbn": "9780544003415",
        "title": "The Hobbit",
        "author": "J.R.R. Tolkien",
        "description": "Bilbo Baggins embarks on an unexpected journey.",
        "category": "fiction",
        "language": "en",
        "condition": "good",
    },
    {
        "isbn": "9780451524935",
        "title": "1984",
        "author": "George Orwell",
        "description": "A dystopian novel set in a totalitarian society.",
        "category": "fiction",
        "language": "en",
        "condition": "good",
    },
    {
        "isbn": "9789750719387",
        "title": "Hayvan Çiftliği",
        "author": "George Orwell",
        "description": "Bir çiftlikteki hayvanların efendilerine karşı ayaklanmasını anlatan alegorik roman.",
        "category": "fiction",
        "language": "tr",
        "condition": "good",
    },
]

# ── Helpers ──────────────────────────────────────────────────────────────────


def info(msg: str) -> None:
    print(f"  ✓ {msg}")


def warn(msg: str) -> None:
    print(f"  ⚠ {msg}", file=sys.stderr)


def fail(msg: str) -> None:
    print(f"  ✗ {msg}", file=sys.stderr)


def step(msg: str) -> None:
    print(f"\n── {msg} ─{'─' * max(0, 60 - len(msg))}")


# ── Seeding Logic ────────────────────────────────────────────────────────────


async def _sync_admin_password(session: Any, user_id: Any, password: str) -> None:
    """Make the bootstrap admin's password match SEED_ADMIN_PASSWORD."""
    from app.core.security import hash_password, verify_password
    from app.modules.auth.models import UserCredential

    cred = (
        await session.execute(select(UserCredential).where(UserCredential.user_id == user_id))
    ).scalar_one_or_none()
    if cred is None:
        now = datetime.now(timezone.utc)
        session.add(
            UserCredential(
                user_id=user_id,
                password_hash=hash_password(password),
                created_at=now,
                updated_at=now,
            )
        )
        info("Bootstrap admin password set.")
    elif not verify_password(password, cred.password_hash):
        cred.password_hash = hash_password(password)
        cred.updated_at = datetime.now(timezone.utc)
        info("Bootstrap admin password rotated from SEED_ADMIN_PASSWORD.")


async def seed() -> int:
    """Main seed function. Returns 0 on success, 1 on failure."""
    settings = get_settings()
    env = settings.env
    is_dev = env in ("development", "dev", "local")

    if os.environ.get("SKIP_SEED"):
        info("SKIP_SEED set — skipping.")
        return 0

    print("=" * 65)
    print(f"  MeetBook — Database Seeding (env: {env})")
    print("=" * 65)

    engine = get_engine()
    factory = get_session_factory()

    try:
        # ── 1. Create admin/dev users ────────────────────────────────────
        step("Seeding users...")
        admin_email = os.environ.get("SEED_ADMIN_EMAIL", "").strip() or BOOTSTRAP_ADMIN["email"]
        admin_password = os.environ.get("SEED_ADMIN_PASSWORD", "")
        admin_seed = (
            [{**BOOTSTRAP_ADMIN, "email": admin_email, "password": admin_password}]
            if admin_password
            else []
        )
        if not admin_password:
            warn("SEED_ADMIN_PASSWORD not set — bootstrap admin not created/updated.")
        users_to_seed = (DEV_USERS if is_dev else []) + admin_seed

        async with factory() as session:
            from app.modules.auth.models import User, UserCredential
            from app.core.security import hash_password

            for user_data in users_to_seed:
                # Check if user exists (select only id to avoid missing-column errors
                # when model has columns the DB doesn't have yet, e.g. during
                # partial migrations — the ORM selects ALL mapped columns.)
                existing = await session.execute(
                    select(User.__table__.c.id).where(User.__table__.c.email == user_data["email"])
                )
                row = existing.first()
                if row:
                    if user_data.get("is_admin"):
                        await _sync_admin_password(session, row[0], user_data["password"])
                    info(f"User '{user_data['email']}' already exists — skipped.")
                    continue

                now = datetime.now(timezone.utc)
                user = User(
                    email=user_data["email"],
                    name=user_data["name"],
                    username=user_data["username"],
                    is_admin=user_data["is_admin"],
                    status=user_data["status"],
                    email_verified_at=now,  # seed users are pre-verified
                    created_at=now,
                    updated_at=now,
                )
                session.add(user)
                await session.flush()

                # Create credential with password (per-user or default)
                pw = user_data.get("password", "changeme123")
                credential = UserCredential(
                    user_id=user.id,
                    password_hash=hash_password(pw),
                    created_at=now,
                    updated_at=now,
                )
                session.add(credential)
                info(f"Created user: {user_data['email']}")

            # Promote listed existing accounts (e.g. the owner's own account).
            admin_emails = [
                e.strip().lower()
                for e in os.environ.get("ADMIN_EMAILS", "").split(",")
                if e.strip()
            ]
            for email in admin_emails:
                result = await session.execute(
                    update(User.__table__)
                    .where(func.lower(User.__table__.c.email) == email)
                    .where(User.__table__.c.is_admin.is_(False))
                    .values(is_admin=True)
                )
                if result.rowcount:
                    info(f"Granted admin: {email}")

            await session.commit()

        # ── 2. Create demo books (dev only) ──────────────────────────────
        if is_dev:
            step("Seeding demo books...")

            # Get demo user
            async with factory() as session:
                from app.modules.books.models import Book

                result = await session.execute(
                    select(User.__table__.c.id).where(User.__table__.c.email == "demo@meetbook.app")
                )
                demo_user = result.first()
                if not demo_user:
                    warn("Demo user not found — skipping books.")
                else:
                    from geoalchemy2.elements import WKTElement

                    for book_data in DEMO_BOOKS:
                        existing = await session.execute(
                            select(Book.__table__.c.id).where(
                                Book.__table__.c.isbn == book_data["isbn"]
                            )
                        )
                        if existing.first():
                            info(f"Book '{book_data['title']}' already exists — skipped.")
                            continue

                        now = datetime.now(timezone.utc)
                        # Seed with a default location (Ankara center)
                        default_location = WKTElement("POINT(32.85 39.92)", srid=4326)
                        book = Book(
                            owner_id=demo_user[0],  # id column
                            isbn=book_data["isbn"],
                            title=book_data["title"],
                            author=book_data["author"],
                            description=book_data["description"],
                            category=book_data.get("category", "other"),
                            language=book_data.get("language", "en"),
                            condition=book_data.get("condition", "good"),
                            is_available=True,
                            location=default_location,
                            public_location=default_location,
                            created_at=now,
                            updated_at=now,
                        )
                        session.add(book)
                        await session.flush()
                        info(f"Created book: {book_data['title']}")

                    await session.commit()

        # ── 3. Seed additional env-specific data ─────────────────────────
        step("Seeding environment defaults...")
        # Add future seed operations here (categories, tags, etc.)
        info("Defaults up to date.")

        print(f"\n{'=' * 65}")
        info("Seeding complete.")
        return 0

    except Exception as e:
        fail(f"Seeding failed: {e}")
        import traceback

        traceback.print_exc()
        return 1


def main() -> int:
    return asyncio.run(seed())


if __name__ == "__main__":
    sys.exit(main())
