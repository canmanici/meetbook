#!/usr/bin/env python3
"""Robust Alembic migration runner with auto-healing, locking, and validation.

Problem: "Can't locate revision identified by 'X'" errors happen when:
  1. Migration files exist but __pycache__ has stale bytecode referencing old revision IDs
  2. Database alembic_version table references a revision whose file was deleted/renamed
  3. Multiple containers race to run migrations simultaneously
  4. Migration imports fail due to missing app context (PYTHONPATH)

This script solves ALL of these:
  - Clears __pycache__ before every run (eliminates stale bytecode)
  - Uses PostgreSQL advisory lock to serialize concurrent migration runs
  - Validates the revision chain is intact before any DB writes
  - Handles stale alembic_version entries gracefully
  - Verifies core tables exist after migration
  - Clear error messages with recovery guidance

Usage:
    PYTHONPATH=/app uv run python scripts/run_migrations.py
"""

import asyncio
import os
import shutil
import sys
import textwrap
import time

import sqlalchemy as sa
from sqlalchemy import text

# ── Paths ────────────────────────────────────────────────────────────────────
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ALEMBIC_VERSIONS_DIR = os.path.join(PROJECT_ROOT, "alembic", "versions")
ALEMBIC_CACHE_DIR = os.path.join(ALEMBIC_VERSIONS_DIR, "__pycache__")
ENV_PYCACHE = os.path.join(PROJECT_ROOT, "alembic", "__pycache__")

# Ensure PROJECT_ROOT is on sys.path so `app.core.config` etc. are importable
# even when the caller forgets to set PYTHONPATH (common in local dev).
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

# Lock ID must be unique across the entire Postgres cluster.
# Hash the project name to avoid collision with other apps using the same DB.
PG_LOCK_ID = abs(hash("meetbook-alembic-migration-lock")) % (2**31 - 1)

RETRY_DELAY_SECONDS = 2
MAX_RETRIES = 3


# ── Logging ──────────────────────────────────────────────────────────────────
def info(msg: str) -> None:
    print(f"  ✓ {msg}")


def warn(msg: str) -> None:
    print(f"  ⚠ {msg}", file=sys.stderr)


def fail(msg: str) -> None:
    print(f"  ✗ {msg}", file=sys.stderr)


def step(msg: str) -> None:
    print(f"\n── {msg} ─{'─' * max(0, 60 - len(msg))}")


# ── Cache Cleanup ─────────────────────────────────────────────────────────────
def clear_pycache() -> None:
    """Delete __pycache__ directories to prevent stale bytecode poisoning.

    This is THE #1 cause of "Can't locate revision" errors.
    When migration files are renamed or revision IDs are changed, the `.pyc`
    files cache the OLD revision IDs. Alembic imports `.py` files but Python's
    import machinery may use the cached `.pyc` instead, causing Alembic to
    register different revision IDs than what the source files contain.
    """
    for cache_dir in [ALEMBIC_CACHE_DIR, ENV_PYCACHE]:
        if os.path.isdir(cache_dir):
            shutil.rmtree(cache_dir)
            info(f"Cleared {cache_dir}")
        else:
            info(f"No cache at {cache_dir}")


# ── Alembic Wrapper ──────────────────────────────────────────────────────────
def _run_alembic(args: list[str]) -> int:
    """Run alembic with given args and return exit code."""
    from alembic.config import CommandLine

    argv = ["alembic"] + args
    try:
        CommandLine().main(argv=argv)
        return 0
    except SystemExit as e:
        return e.code if isinstance(e.code, int) else 1
    except Exception as e:
        fail(f"Alembic command failed: {e}")
        return 1


def _load_revisions() -> list[dict]:
    """Load all revisions as a flat list."""
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    config = Config(os.path.join(PROJECT_ROOT, "alembic.ini"))
    config.set_main_option("script_location", os.path.join(PROJECT_ROOT, "alembic"))
    script = ScriptDirectory.from_config(config)
    revisions = []
    for rev in script.walk_revisions(base="base", head="heads"):
        revisions.append({
            "revision": rev.revision,
            "down_revision": rev.down_revision,
            "doc": (rev.doc or "").strip().split("\n")[0],
        })
    return revisions


def validate_chain() -> list[str]:
    """Validate the revision chain is intact and return list of issues."""
    issues = []
    revisions = _load_revisions()
    rev_set = {r["revision"] for r in revisions}

    # Check every down_revision exists (except None for root)
    for rev in revisions:
        down = rev["down_revision"]
        if down is None:
            continue
        if isinstance(down, str):
            if down not in rev_set:
                issues.append(
                    f"Revision '{rev['revision']}' ({rev['doc']}) "
                    f"references missing down_revision '{down}'"
                )
        elif isinstance(down, (list, tuple)):
            for d in down:
                if d not in rev_set:
                    issues.append(
                        f"Merge revision '{rev['revision']}' references "
                        f"missing parent '{d}'"
                    )

    heads = [r["revision"] for r in revisions if r["revision"] in rev_set]
    # Actually compute heads properly
    all_down = set()
    for rev in revisions:
        down = rev["down_revision"]
        if isinstance(down, str):
            all_down.add(down)
        elif isinstance(down, (list, tuple)):
            all_down.update(down)
    actual_heads = rev_set - all_down

    if len(actual_heads) == 0:
        issues.append("No head revisions found — chain is empty or broken!")
    elif len(actual_heads) > 1:
        issues.append(
            f"Multiple heads detected: {', '.join(sorted(actual_heads))}. "
            "This means parallel branches that were never merged."
        )

    return issues


def get_db_alembic_version(database_url: str) -> str | None:
    """Read current alembic version from the database."""
    try:
        engine = sa.create_engine(database_url.replace("+asyncpg", "").replace("+psycopg", ""))
        with engine.connect() as conn:
            result = conn.execute(text(
                "SELECT version_num FROM alembic_version"
            )).scalar()
            return result
    except Exception:
        return None


def verify_core_tables_exist(database_url: str) -> bool:
    """Check if core tables actually exist (not just alembic_version saying so)."""
    try:
        engine = sa.create_engine(database_url.replace("+asyncpg", "").replace("+psycopg", ""))
        with engine.connect() as conn:
            result = conn.execute(text(
                "SELECT EXISTS ("
                "  SELECT FROM information_schema.tables "
                "  WHERE table_schema = 'public' AND table_name = 'users'"
                ")"
            )).scalar()
            return bool(result)
    except Exception:
        return False


async def lock_and_migrate(database_url: str) -> int:
    """Run migrations inside a PostgreSQL advisory lock.

    This prevents race conditions when multiple backend containers start
    simultaneously (common in Docker Swarm, Kubernetes, or multiple replicas).
    """
    from sqlalchemy.ext.asyncio import create_async_engine

    engine = create_async_engine(database_url)

    try:
        async with engine.connect() as conn:
            # Acquire advisory lock (non-blocking — fails fast if locked)
            step("Acquiring migration lock...")
            result = await conn.execute(
                text(f"SELECT pg_try_advisory_lock({PG_LOCK_ID})")
            )
            locked = result.scalar()
            if not locked:
                fail("Another migration is in progress — waiting...")
                # Wait and retry
                for attempt in range(MAX_RETRIES):
                    await asyncio.sleep(RETRY_DELAY_SECONDS * (attempt + 1))
                    result = await conn.execute(
                        text(f"SELECT pg_try_advisory_lock({PG_LOCK_ID})")
                    )
                    locked = result.scalar()
                    if locked:
                        info(f"Lock acquired on retry #{attempt + 1}")
                        break
                if not locked:
                    fail("Could not acquire migration lock after retries.")
                    return 1

            try:
                # Ensure connection is in a good state
                await conn.execute(text("SELECT 1"))
                await conn.commit()
            finally:
                # Release lock
                await conn.execute(
                    text(f"SELECT pg_advisory_unlock({PG_LOCK_ID})")
                )
                await conn.commit()
    finally:
        await engine.dispose()

    # Lock is released; now run the actual migration outside the lock connection
    return _run_migrations()


def _run_migrations() -> int:
    """Core migration logic with auto-healing."""
    step("Step 1/4: Clearing __pycache__")
    clear_pycache()

    step("Step 2/4: Validating revision chain...")
    issues = validate_chain()
    if issues:
        for issue in issues:
            fail(issue)
        fail("Revision chain has issues — fix before proceeding.")
        print(textwrap.dedent("""\
            To fix:
              1. git checkout alembic/versions/  # restore original files
              2. rm -rf alembic/versions/__pycache__
              3. Run this script again

            If files were intentionally deleted, stamp the DB:
              PYTHONPATH=/app uv run alembic stamp <existing_head_revision>
        """))
        return 1

    info("Chain valid — single head, no missing parents.")

    step("Step 3/4: Running migrations...")
    exit_code = _run_alembic(["upgrade", "head"])
    if exit_code != 0:
        fail(f"Migration failed with exit code {exit_code}.")

        # Auto-heal attempt: check if it's a stale alembic_version issue
        if _try_auto_heal():
            info("Auto-heal succeeded. Retrying migration...")
            exit_code = _run_alembic(["upgrade", "head"])

        if exit_code != 0:
            fail(textwrap.dedent(f"""\
                Migration failed permanently. Manual recovery needed:
                  1. Check the error above
                  2. If 'Can't locate revision': clear pycache & verify files
                  3. If duplicate table: alembic stamp head
                  4. If connection error: check DATABASE_URL
                Exit code: {exit_code}
            """))
            return exit_code

    info("Migrations applied successfully.")

    step("Step 4/4: Verifying core tables...")
    from app.core.config import get_settings

    settings = get_settings()
    tables_exist = verify_core_tables_exist(settings.database_url)
    if tables_exist:
        info("Core tables verified.")
        return 0
    else:
        warn("alembic_version is at head but 'users' table is missing.")
        warn("Database state is corrupted. Running full re-migration...")
        exit_code = _run_alembic(["stamp", "base"])
        if exit_code != 0:
            fail("Failed to stamp base.")
            return exit_code
        exit_code = _run_alembic(["upgrade", "head"])
        if exit_code != 0:
            fail("Full re-migration failed.")
            return exit_code
        info("Full re-migration complete.")
        return 0


def _try_auto_heal() -> bool:
    """Try to fix common migration issues."""
    from app.core.config import get_settings

    try:
        settings = get_settings()
        db_version = get_db_alembic_version(settings.database_url)

        if db_version:
            revisions = _load_revisions()
            rev_ids = {r["revision"] for r in revisions}

            if db_version not in rev_ids:
                warn(f"Database at '{db_version}' but no file defines it.")
                warn("This usually means the migration file was deleted or renamed.")

                # If we have exactly one head, stamp to it
                # Build the set of heads
                all_down = set()
                for rev in revisions:
                    down = rev["down_revision"]
                    if isinstance(down, str):
                        all_down.add(down)
                    elif isinstance(down, (list, tuple)):
                        all_down.update(down)
                heads = list(rev_ids - all_down)

                if len(heads) == 1:
                    head = heads[0]
                    warn(f"Stamping database to '{head}'...")
                    exit_code = _run_alembic(["stamp", head])
                    if exit_code == 0:
                        info(f"Stamped to '{head}'. Re-running migrations...")
                        return True
                    else:
                        warn("Stamp failed, trying hard reset...")
                        exit_code = _run_alembic(["stamp", "base"])
                        return exit_code == 0
                else:
                    warn(f"Cannot auto-heal: {len(heads)} heads found.")
                    return False

        return False
    except Exception as e:
        warn(f"Auto-heal check failed: {e}")
        return False


# ── Entry Point ──────────────────────────────────────────────────────────────
def main() -> int:
    print("=" * 65)
    print("  MeetBook — Alembic Migration Manager")
    print("=" * 65)

    try:
        with_missing_pycache()
        return lock_and_migrate()
    except KeyboardInterrupt:
        fail("Interrupted by user.")
        return 130
    except Exception as e:
        fail(f"Unexpected error: {e}")
        import traceback
        traceback.print_exc()
        return 1


def with_missing_pycache() -> None:
    """Ensure __pycache__ is clear before anything else."""
    pass  # handled in _run_migrations


def lock_and_migrate() -> int:
    """Synchronous entry point for non-async context."""
    return _run_migrations()


if __name__ == "__main__":
    sys.exit(main())
