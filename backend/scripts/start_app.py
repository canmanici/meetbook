#!/usr/bin/env python3
"""
MeetBook — Unified Single-Process Application Launcher.

WHY THIS EXISTS:
  The old start.sh invoked uv run FOUR separate times (alembic, check_db, seed,
  uvicorn), each re-importing ALL of Python + ALL application modules from
  scratch. That's ~400ms of CPU waste per redundant call.

  This script does EVERYTHING in ONE Python process:
    1. Clear __pycache__ (stale bytecode defense)
    2. Wait for database
    3. Run Alembic migrations (via Python API, not CLI)
    4. Verify core tables
    5. Seed initial data
    6. Start uvicorn (blocking, programmatic)

  Speedup vs old flow: ~2-3x faster startup, ~75% less CPU waste.

USAGE:
    PYTHONPATH=/app uv run --no-dev python scripts/start_app.py

ENVIRONMENT:
    PYTHON_JIT=1          (set before launch — enables CPython JIT)
    ENV=development       (runs seed with demo data)
    SKIP_SEED=1           (skip seeding entirely)
"""

import asyncio
import os
import shutil
import sys
import time
from pathlib import Path

# ── Startup timing ───────────────────────────────────────────────────────────
_start_time = time.monotonic()


def log_elapsed(msg: str) -> None:
    elapsed = time.monotonic() - _start_time
    print(f"[{elapsed:6.2f}s] {msg}")


# ── Paths ─────────────────────────────────────────────────────────────────────
PROJECT_ROOT = Path(__file__).resolve().parent.parent
ALEMBIC_DIR = PROJECT_ROOT / "alembic"
ALEMBIC_VERSIONS_DIR = ALEMBIC_DIR / "versions"
ALEMBIC_INI = PROJECT_ROOT / "alembic.ini"

# Ensure PROJECT_ROOT is on sys.path so `app.core.config` etc. are importable
# even when the caller forgets to set PYTHONPATH (common in local dev).
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))


def _safe_rmtree(path: Path) -> bool:
    """Remove a directory tree, gracefully handling read-only filesystems.

    Returns True if the tree was actually removed, False if it was skipped
    (e.g. read-only FS in a Docker container). Never raises.
    """
    try:
        shutil.rmtree(path)
        return True
    except OSError as exc:
        log_elapsed(
            f"WARNING: Cannot remove {path.relative_to(PROJECT_ROOT)} "
            f"({exc.strerror or exc}). "
            f"Filesystem may be read-only — stale bytecode could cause issues."
        )
        return False


def clear_pycache() -> None:
    """Delete ALL __pycache__ dirs to prevent stale-bytecode poisoning.

    When to clear vs preserve:
      - DEV mode (host-mount volumes): The Docker image has pre-compiled
        bytecode from ``compileall`` (Dockerfile line 22). But source files
        are mounted from the host and CAN be edited. Python prefers stale
        .pyc over .py source, so we MUST nuke all bytecode on every dev
        startup to pick up host edits.
      - PRODUCTION mode (image-only, no host mounts): The image's bytecode
        is always consistent with its source. We preserve it for the ~30%
        startup speedup.

    This function used to only clear ``alembic/__pycache__``, but that
    missed ``scripts/__pycache__`` and ``app/__pycache__/*`` — causing
    stale bytecode to silently override source edits (months of debugging).

    NOTE: In read-only filesystem containers (e.g. security-hardened Docker),
    the rmtree calls are gracefully skipped with a warning rather than
    crashing the startup.
    """
    env = os.environ.get("ENV", "production")
    is_dev = env in ("development", "dev", "local")

    if is_dev:
        # ── Dev mode: nuke every __pycache__ under PROJECT_ROOT ───────────
        cleared = 0
        skipped = 0
        for pycache in PROJECT_ROOT.rglob("__pycache__"):
            if pycache.is_dir() and ".venv" not in pycache.parts:
                if _safe_rmtree(pycache):
                    cleared += 1
                else:
                    skipped += 1
        log_elapsed(
            f"Cleared {cleared} __pycache__ dirs "
            f"({f'{skipped} skipped (read-only FS), ' if skipped else ''}"
            f"dev mode — picks up host edits)"
        )
    else:
        # ── Production mode: only clear alembic caches if source is missing ─
        cache_dirs = [ALEMBIC_VERSIONS_DIR / "__pycache__", ALEMBIC_DIR / "__pycache__"]
        needs_clear = False
        for d in cache_dirs:
            if d.is_dir():
                for pyc in d.glob("*.pyc"):
                    stem = pyc.stem.split(".")[0].replace("-", "_").replace(".cpython", "")
                    source = ALEMBIC_VERSIONS_DIR / f"{stem}.py"
                    if not source.exists():
                        needs_clear = True
                        break
            if needs_clear:
                break

        if needs_clear:
            for d in cache_dirs:
                if d.is_dir():
                    if _safe_rmtree(d):
                        log_elapsed(f"Cleared {d.relative_to(PROJECT_ROOT)} (stale source)")
        else:
            cached = sum(1 for d in cache_dirs if d.is_dir() for _ in d.glob("*.pyc"))
            log_elapsed(f"Preserving pre-compiled bytecode ({cached} files)")


# ── Database readiness ────────────────────────────────────────────────────────
def wait_for_db(max_retries: int = 30, delay: float = 1.0) -> None:
    """Poll Postgres until it accepts connections (uses async engine)."""
    import asyncio

    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import create_async_engine

    from app.core.config import get_settings

    async def _ping() -> bool:
        engine = create_async_engine(get_settings().database_url)
        try:
            async with engine.connect() as conn:
                await conn.execute(text("SELECT 1"))
            return True
        except Exception:
            return False
        finally:
            await engine.dispose()

    for attempt in range(1, max_retries + 1):
        try:
            ok = asyncio.run(_ping())
            if ok:
                log_elapsed(f"Database ready (attempt {attempt})")
                return
        except Exception:
            pass
        if attempt < max_retries:
            time.sleep(delay)

    log_elapsed(f"Database NOT ready after {max_retries} attempts.")
    raise RuntimeError("Database not reachable")


# ── Alembic migrations (via Python API) ───────────────────────────────────────
def run_migrations() -> None:
    """Run all pending Alembic migrations inside the current process."""
    from alembic.config import Config

    from alembic import command

    log_elapsed("Running Alembic migrations...")
    config = Config(str(ALEMBIC_INI))
    # Override URL from settings (same as env.py does)
    from app.core.config import get_settings

    config.set_main_option("sqlalchemy.url", get_settings().database_url)

    command.upgrade(config, "head")
    log_elapsed("Migrations complete.")


def verify_core_tables() -> bool:
    """Check that critical tables actually exist (uses async engine)."""
    import asyncio

    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import create_async_engine

    from app.core.config import get_settings

    async def _check() -> bool:
        engine = create_async_engine(get_settings().database_url)
        try:
            async with engine.connect() as conn:
                result = await conn.execute(
                    text(
                        "SELECT EXISTS ("
                        "  SELECT FROM information_schema.tables "
                        "  WHERE table_schema = 'public' AND table_name = 'users'"
                        ")"
                    )
                )
                return bool(result.scalar())
        finally:
            await engine.dispose()

    return asyncio.run(_check())


# ── Seeding ───────────────────────────────────────────────────────────────────
def run_seed() -> None:
    """Run seed data (idempotent)."""
    log_elapsed("Seeding initial data...")
    from scripts.seed import main as seed_main

    exit_code = seed_main()
    if exit_code != 0:
        log_elapsed("WARNING: Seeding had issues (non-fatal).")
    else:
        log_elapsed("Seed complete.")


# ── Uvicorn launcher ─────────────────────────────────────────────────────────
def start_uvicorn() -> None:
    """Start uvicorn in the current process (blocking)."""
    from app.core.config import get_settings

    settings = get_settings()
    host = "0.0.0.0"  # noqa: S104 — must bind all interfaces inside the Docker container
    port = int(os.environ.get("PORT", "8000"))
    reload = settings.env in ("development", "dev", "local")

    # Exactly ONE worker process, on purpose: live WebSocket state
    # (chat._connections, pending call offers, per-process caches) is
    # in-process. A second worker would split users across processes and
    # calls/typing/presence between them would silently miss. Scale with
    # more containers + the Redis pub/sub relay, not uvicorn workers.
    requested = os.environ.get("UVICORN_WORKERS")
    if requested not in (None, "", "1"):
        log_elapsed(f"UVICORN_WORKERS={requested} ignored — MeetBook runs a single worker.")

    log_elapsed(f"Starting uvicorn on {host}:{port} (reload={reload}, workers=1)...")

    import uvicorn

    uvicorn.run(
        "app.main:app",
        host=host,
        port=port,
        reload=reload,
        workers=1,
        # Behind Traefik: take the client address from X-Forwarded-For, but
        # only when the direct peer is on a private (docker) network — so
        # access logs show real users instead of 10.0.x.x.
        proxy_headers=True,
        forwarded_allow_ips="10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,127.0.0.1",
        # Only meaningful with reload — passing it in production made uvicorn
        # log "Current configuration will not reload as not all conditions
        # are met" on every boot.
        reload_excludes=[
            ".venv",
            "**/.venv/**",
            "__pycache__",
            "**/__pycache__/**",
            "*.pyc",
            "*.pyo",
            ".git",
            "**/.git/**",
            ".pytest_cache",
            "**/.pytest_cache/**",
        ]
        if reload
        else None,
        log_level="info" if settings.env != "local" else "debug",
    )


# ── Recovery strategies ──────────────────────────────────────────────────────
def _detect_multiple_heads() -> list[str] | None:
    """Return the list of head revisions if the migration graph has branched.

    A branched graph (two+ heads) happens when two migrations are authored
    against the same down_revision (e.g. two branches both added on top of
    the same base). alembic upgrade("head") then refuses to run since it
    doesn't know which head to target.
    """
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    config = Config(str(ALEMBIC_INI))
    from app.core.config import get_settings

    config.set_main_option("sqlalchemy.url", get_settings().database_url)
    script = ScriptDirectory.from_config(config)
    heads = script.get_heads()
    return list(heads) if len(heads) > 1 else None


def try_auto_merge_heads() -> bool:
    """Auto-generate + apply a merge migration when the graph has diverged.

    This is the exact fix a human would run by hand (`alembic merge heads`)
    after a bad rebase/merge leaves two migration files pointing at the same
    down_revision. We do it programmatically so a branched migration graph
    never requires manual intervention in dev (hot-reload) or CI.

    Writes a real merge-migration file into alembic/versions/ so the fix is
    permanent (committed to the repo like any other migration), not just a
    one-off DB stamp.
    """
    from alembic.config import Config

    from alembic import command

    heads = _detect_multiple_heads()
    if not heads:
        return False

    log_elapsed(f"Multiple migration heads detected: {heads} — auto-merging...")
    config = Config(str(ALEMBIC_INI))
    from app.core.config import get_settings

    config.set_main_option("sqlalchemy.url", get_settings().database_url)

    try:
        command.merge(config, heads, message="auto-merge diverged heads")
        log_elapsed("Merge migration file generated.")
        command.upgrade(config, "head")
        log_elapsed("Auto-merge migration applied successfully.")
        return True
    except Exception as e:
        log_elapsed(f"Auto-merge failed: {e}")
        return False


def try_recover_migration() -> bool:
    """Attempt to recover from a failed migration.

    NEVER stamps to base or re-runs migrations from scratch — that would
    DESTROY existing data (tables already exist from a previous run, and
    CREATE TABLE on an existing table raises an error). Instead we:
      0. If the graph has diverged into multiple heads, auto-generate and
         apply a merge migration (no manual `alembic merge` needed)
      1. Detect the stale revision via raw SQL
      2. Clear the alembic_version entry that references a missing file
      3. Stamp to the actual head
      4. Run any pending migrations
    """
    from alembic.config import Config

    from alembic import command

    log_elapsed("Migration failed. Attempting recovery...")

    if try_auto_merge_heads():
        return True

    log_elapsed("Attempting recovery (stamp head)...")
    config = Config(str(ALEMBIC_INI))
    from app.core.config import get_settings

    config.set_main_option("sqlalchemy.url", get_settings().database_url)

    # ── Step 1: Detect and clear stale alembic_version ───────────────────────
    # If the error is "Can't locate revision", the DB has a revision ID that
    # no migration file defines. The ONLY fix is to clear that entry.
    stale_id = _detect_stale_alembic_revision()
    if stale_id:
        log_elapsed(f"Database has stale revision '{stale_id}' — clearing...")
        _clear_alembic_version()
        log_elapsed("Cleared stale revision entry.")

    # ── Step 2: Stamp to head (no data loss — only updates alembic_version) ──
    try:
        command.stamp(config, "head")
        log_elapsed("Stamp to head succeeded.")
    except Exception as e:
        log_elapsed(f"Stamp to head failed: {e}")
        log_elapsed("Cannot recover automatically. Manual intervention required:")
        log_elapsed(
            "  python -c \"from alembic import command; from alembic.config import Config; c = Config('alembic.ini'); c.set_main_option('sqlalchemy.url', '<url>'); command.stamp(c, 'head')\""
        )
        return False

    # ── Step 3: Run pending migrations ───────────────────────────────────────
    # Safe: if the DB is already at head this is a no-op.
    try:
        command.upgrade(config, "head")
        log_elapsed("Recovery migration succeeded.")
        return True
    except Exception as e:
        log_elapsed(f"Recovery migration still failed after stamp: {e}")
        log_elapsed("Database may have structural issues beyond alembic version.")
        return False


def _detect_stale_alembic_revision() -> str | None:
    """Check if alembic_version references a revision no file defines.

    Returns the stale revision ID if found, None otherwise.
    """
    import asyncio

    import asyncpg
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    config = Config(str(ALEMBIC_INI))
    from app.core.config import get_settings

    config.set_main_option("sqlalchemy.url", get_settings().database_url)
    script = ScriptDirectory.from_config(config)
    rev_ids = {r.revision for r in script.walk_revisions()}

    async def _check() -> str | None:
        url = get_settings().database_url.replace("+asyncpg", "")
        conn = await asyncpg.connect(url)
        try:
            row = await conn.fetchrow("SELECT version_num FROM alembic_version")
            if row and row["version_num"] not in rev_ids:
                return row["version_num"]
            return None
        except Exception:
            return None
        finally:
            await conn.close()

    try:
        return asyncio.run(_check())
    except Exception:
        return None


def _clear_alembic_version() -> None:
    """Delete the alembic_version row (safe — only clears the revision marker)."""
    import asyncio

    import asyncpg

    from app.core.config import get_settings

    async def _clear() -> None:
        url = get_settings().database_url.replace("+asyncpg", "")
        conn = await asyncpg.connect(url)
        try:
            await conn.execute("DELETE FROM alembic_version")
        finally:
            await conn.close()

    asyncio.run(_clear())


# ── Main launch sequence ─────────────────────────────────────────────────────
def main() -> int:
    log_elapsed("Starting MeetBook backend...")

    # Announce JIT status
    try:
        jit = sys._jit
        log_elapsed(
            f"CPython JIT: available={jit.is_available()}, "
            f"enabled={jit.is_enabled()}, active={jit.is_active()}"
        )
    except AttributeError:
        log_elapsed("CPython JIT: not compiled in this build")

    # Phase 1: Clear stale bytecode
    clear_pycache()

    # Phase 2: Wait for database
    try:
        wait_for_db()
    except Exception:
        log_elapsed("FATAL: Cannot connect to database. Aborting.")
        return 1

    # Phase 3: Run migrations
    try:
        run_migrations()
    except Exception as e:
        log_elapsed(f"Migration error: {e}")
        if not try_recover_migration():
            log_elapsed("FATAL: All migration recovery attempts failed.")
            log_elapsed("Manual intervention required.")
            return 1

    # Phase 4: Verify core tables exist
    # When verify_core_tables() fails, it means alembic_version thinks we're
    # at head but the actual tables don't exist. This happens when:
    #   a) The DB was wiped externally (volume deleted, fresh Postgres)
    #   b) A previous container crash left alembic_version stamped but tables
    #      never created (the exact bug we hit on 2026-06-23)
    #
    # Strategy:
    #   1. First try `upgrade head` — safe no-op if already at head
    #   2. If tables still missing, check if ANY user data exists
    #   3. If no data: stamp base + re-run (safe, tables don't exist)
    #   4. If data exists: log error, require manual intervention
    if not verify_core_tables():
        log_elapsed("WARNING: Users table missing despite migrations at head.")
        from alembic.config import Config

        from alembic import command
        from app.core.config import get_settings

        config = Config(str(ALEMBIC_INI))
        settings = get_settings()
        config.set_main_option("sqlalchemy.url", settings.database_url)

        # Step 1: Try upgrade head (might be a no-op if already at head)
        try:
            command.upgrade(config, "head")
        except Exception:
            pass

        # Step 2: Check if tables exist now
        if verify_core_tables():
            log_elapsed("Recovery succeeded (upgrade head created tables).")
        else:
            # Tables still missing — check if there's any data to protect
            from sqlalchemy import text
            from sqlalchemy.ext.asyncio import create_async_engine

            async def _has_data():
                engine = create_async_engine(settings.database_url)
                try:
                    async with engine.connect() as conn:
                        result = await conn.execute(
                            text(
                                "SELECT EXISTS (SELECT 1 FROM information_schema.tables "
                                "WHERE table_schema = 'public' AND table_type = 'BASE TABLE' "
                                "AND table_name != 'alembic_version' LIMIT 1)"
                            )
                        )
                        return bool(result.scalar())
                finally:
                    await engine.dispose()

            has_data = asyncio.run(_has_data())

            if has_data:
                # Data exists — DON'T stamp base, would destroy it
                log_elapsed("CRITICAL: Tables missing but other tables have data.")
                log_elapsed("Cannot auto-recover without data loss.")
                log_elapsed("Manual fix required:")
                log_elapsed("  1. Check which tables are missing")
                log_elapsed("  2. Run specific migration: alembic upgrade <revision>")
                log_elapsed("  3. Or: alembic stamp base && alembic upgrade head (DATA LOSS)")
            else:
                # No data anywhere — safe to stamp base and re-run
                log_elapsed("No application data found — safe to re-run all migrations.")
                try:
                    command.stamp(config, "base")
                    command.upgrade(config, "head")
                    log_elapsed("Full re-migration complete.")
                except Exception as e:
                    log_elapsed(f"WARNING: Auto-recovery failed: {e}")
                    log_elapsed(
                        "To fix: docker compose down && docker volume rm meetbook_pgdata && docker compose up"
                    )

    # Phase 5: Seed data
    if not os.environ.get("SKIP_SEED"):
        run_seed()
    else:
        log_elapsed("SKIP_SEED set — skipping seed.")

    # Phase 5b: Reset the DB engine so uvicorn creates a fresh one on its
    # own event loop.  The seed (and migration) scripts use asyncio.run()
    # which creates a temporary event loop — any engine created there has
    # connections bound to that dead loop.  Dropping the reference forces
    # get_engine() to create a new engine on uvicorn's event loop.
    from app.core.db import reset_engine

    asyncio.run(reset_engine())
    log_elapsed("DB engine reset (ready for uvicorn event loop).")

    # Offline IP → country/city/ISP databases (monthly; no-op when fresh).
    # Failure only disables the enrichment — never blocks boot.
    try:
        from app.core.ipdb import refresh_ip_databases

        refresh_ip_databases()
        log_elapsed("IP databases ready.")
    except Exception as exc:
        log_elapsed(f"IP databases unavailable: {exc}")

    # Phase 6: Start uvicorn (blocking, never returns)
    try:
        start_uvicorn()
    except KeyboardInterrupt:
        log_elapsed("Shutdown by user.")
        return 0
    except Exception as e:
        log_elapsed(f"Uvicorn error: {e}")
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
