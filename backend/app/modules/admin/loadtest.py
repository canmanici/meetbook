"""Admin load test — run a full API load test from the admin panel.

Production has no shell, so the whole test lifecycle lives behind admin
endpoints:

  1. Leftovers from an earlier crashed run are purged.
  2. Synthetic users are created directly in the DB, tagged by the reserved
     reserved ``@loadtest.meetbook.example.com`` domain (never deliverable;
     registration refuses it, so no real account can match). Their books sit at sea off Kaş, where no
     real user searches.
  3. Maintenance mode goes on (app/core/maintenance.py): everyone except
     admins and the test's own traffic gets a 503. Existing WebSocket
     sessions are closed, background jobs (geofence alerts etc.) are paused.
  4. A separate process (loadtest_runner.py) drives the API over real HTTP
     and WebSocket on 127.0.0.1 and streams per-phase results back. This
     process samples its own CPU, RAM, DB pool and event-loop lag meanwhile.
  5. Every row the test users created is deleted — following the FK graph
     read from Postgres, so new tables are covered without code changes.
     Real users' data is never touched and nothing is rolled back.
  6. Maintenance mode ends; results are stored in load_test_runs.

The load generator shares the server's CPU(s). On a single-CPU host its own
usage is reported per phase (runner_cpu_pct) so the numbers can be read in
context: they are a floor, not a ceiling.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import os
import platform
import secrets
import signal
import sys
import time
import uuid
from collections import deque
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import maintenance
from app.core.audit import log_event
from app.core.config import get_settings
from app.core.db import get_engine, get_session, get_session_factory
from app.core.security import create_access_token, hash_password
from app.modules.admin.loadtest_models import LoadTestRun
from app.modules.admin.loadtest_runner import SCENARIOS
from app.modules.auth.dependencies import get_admin_user
from app.modules.auth.models import User, UserCredential, UserStatus

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin/loadtest", tags=["admin-loadtest"])

TEST_EMAIL_DOMAIN = maintenance.LOADTEST_EMAIL_DOMAIN
# Exactly the addresses _create_test_users generates: lt-<8 hex>-<n>@domain.
_TEST_USERS_SQL = "email ~ '^lt-[0-9a-f]{8}-[0-9]+@" + TEST_EMAIL_DOMAIN.replace(".", "\\.") + "$'"
# Open sea ~60 km south of Kemer: inside the Turkey bbox books must be in,
# but nowhere a real user lives or searches.
AREA = {"lat": 35.95, "lng": 30.5}

MAX_TOTAL_SECONDS = 20 * 60
_BACKEND_ROOT = Path(__file__).resolve().parents[3]

PROFILES: dict[str, dict[str, Any]] = {
    "quick": {"label": "Hızlı", "concurrency": 16, "duration_s": 5, "users": 6},
    "standard": {"label": "Standart", "concurrency": 32, "duration_s": 10, "users": 10},
    "heavy": {"label": "Yoğun", "concurrency": 64, "duration_s": 15, "users": 16},
}


# ── Request schema ──────────────────────────────────────────────────────────


class LoadTestStartRequest(BaseModel):
    profile: str = "standard"
    concurrency: int = Field(default=32, ge=1, le=256)
    duration_s: int = Field(default=10, ge=3, le=60)
    scenarios: list[str] = Field(default_factory=lambda: list(SCENARIOS))
    mixed: bool = True
    ramp: bool = True
    ramp_steps: list[int] = Field(default_factory=lambda: [4, 8, 16, 32, 64, 128])
    ramp_duration_s: int = Field(default=8, ge=3, le=60)
    users: int = Field(default=10, ge=2, le=50)
    books_per_user: int = Field(default=2, ge=1, le=5)
    # The caller must acknowledge that real users get a 503 meanwhile.
    confirm_maintenance: bool = False


def _estimate_seconds(cfg: LoadTestStartRequest) -> int:
    setup = 5 + cfg.users * (cfg.books_per_user * 0.1 + 0.5)
    phases = len(cfg.scenarios) * cfg.duration_s + (cfg.duration_s if cfg.mixed else 0)
    ramp = len(cfg.ramp_steps) * cfg.ramp_duration_s if cfg.ramp else 0
    cleanup = 15
    return int(setup + phases + ramp + cleanup + 2 * (len(cfg.scenarios) + len(cfg.ramp_steps)))


# ── Server-side sampling ────────────────────────────────────────────────────


def _rss_mb() -> float:
    try:
        with open("/proc/self/statm") as f:
            return int(f.read().split()[1]) * os.sysconf("SC_PAGE_SIZE") / 2**20
    except OSError:
        import resource

        return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024


class _Sampler:
    """Samples this (server) process while a phase runs."""

    INTERVAL = 0.25

    def __init__(self) -> None:
        self._task: asyncio.Task[None] | None = None
        self.reset()

    def reset(self) -> None:
        self.t0 = time.monotonic()
        self.cpu0 = time.process_time()
        self.lags: list[float] = []
        self.rss: list[float] = []
        self.pool_out: list[int] = []
        self.pool_overflow: list[int] = []

    def start(self) -> None:
        self._task = asyncio.create_task(self._loop())

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task

    async def _loop(self) -> None:
        pool = get_engine().pool
        while True:
            before = time.monotonic()
            await asyncio.sleep(self.INTERVAL)
            self.lags.append(max(0.0, time.monotonic() - before - self.INTERVAL))
            self.rss.append(_rss_mb())
            with contextlib.suppress(Exception):
                self.pool_out.append(pool.checkedout())  # type: ignore[attr-defined]
                self.pool_overflow.append(max(0, pool.overflow()))  # type: ignore[attr-defined]

    def snapshot(self) -> dict[str, Any]:
        wall = max(time.monotonic() - self.t0, 1e-6)
        lags = sorted(self.lags)
        return {
            "cpu_pct": round((time.process_time() - self.cpu0) / wall * 100, 1),
            "rss_mb_max": round(max(self.rss), 1) if self.rss else round(_rss_mb(), 1),
            "pool_checked_out_max": max(self.pool_out, default=0),
            "pool_overflow_max": max(self.pool_overflow, default=0),
            "loop_lag_p95_ms": round(lags[int(len(lags) * 0.95)] * 1000, 1) if lags else 0.0,
            "loop_lag_max_ms": round(lags[-1] * 1000, 1) if lags else 0.0,
        }


# ── Run state (in-process; the app runs a single worker) ────────────────────


class _Run:
    def __init__(self, run_id: uuid.UUID, admin_id: uuid.UUID, cfg: LoadTestStartRequest) -> None:
        self.id = run_id
        self.admin_id = admin_id
        self.cfg = cfg
        self.key = secrets.token_urlsafe(32)
        self.status = "starting"  # starting|setup|running|cleanup|completed|stopped|failed
        self.started_wall = datetime.now(UTC)
        self.started = time.monotonic()
        self.estimate_s = _estimate_seconds(cfg)
        self.phases: list[dict[str, Any]] = []
        self.current: dict[str, Any] | None = None
        self.series: deque[dict[str, Any]] = deque(maxlen=900)  # live rps points
        self.log: deque[str] = deque(maxlen=200)
        self.setup: dict[str, Any] = {}
        self.skipped: list[dict[str, Any]] = []
        self.cleanup: dict[str, int] = {}
        self.error: str | None = None
        self.stop_requested = False
        self.proc: asyncio.subprocess.Process | None = None
        self.sampler = _Sampler()
        self.env_before: dict[str, Any] = {}
        self.task: asyncio.Task[None] | None = None

    def note(self, msg: str) -> None:
        self.log.append(f"{datetime.now(UTC).strftime('%H:%M:%S')} {msg}")

    def live(self) -> dict[str, Any]:
        return {
            "id": str(self.id),
            "status": self.status,
            "elapsed_s": round(time.monotonic() - self.started, 1),
            "estimate_s": self.estimate_s,
            "maintenance_left_s": maintenance.seconds_left(),
            "current": self.current,
            "phases": self.phases,
            "series": list(self.series),
            "setup": self.setup,
            "skipped": self.skipped,
            "log": list(self.log),
            "error": self.error,
            "config": self.cfg.model_dump(),
            "planned_phases": _planned_phases(self.cfg),
        }


_run: _Run | None = None
_scheduler: Any = None  # set by lifespan (AsyncIOScheduler)


def set_scheduler(scheduler: Any) -> None:
    global _scheduler
    _scheduler = scheduler


def _planned_phases(cfg: LoadTestStartRequest) -> int:
    return len(cfg.scenarios) + (1 if cfg.mixed else 0) + (len(cfg.ramp_steps) if cfg.ramp else 0)


# ── Test data: create + purge ───────────────────────────────────────────────


async def count_leftovers(session: AsyncSession) -> int:
    sql = f"SELECT count(*) FROM users WHERE {_TEST_USERS_SQL}"  # noqa: S608 — constant
    return int((await session.execute(text(sql))).scalar() or 0)


async def _fk_children(session: AsyncSession) -> dict[str, list[tuple[str, str, str, str]]]:
    """parent table -> [(child table, child col, parent col, on-delete action)].

    Single-column FKs in the public schema, read live from the catalog.
    """
    rows = await session.execute(
        text(
            """
            SELECT c.confrelid::regclass::text, c.conrelid::regclass::text,
                   ca.attname, pa.attname, c.confdeltype::text
            FROM pg_constraint c
            JOIN pg_attribute ca ON ca.attrelid = c.conrelid AND ca.attnum = c.conkey[1]
            JOIN pg_attribute pa ON pa.attrelid = c.confrelid AND pa.attnum = c.confkey[1]
            WHERE c.contype = 'f' AND array_length(c.conkey, 1) = 1
              AND c.connamespace = 'public'::regnamespace
            """
        )
    )
    graph: dict[str, list[tuple[str, str, str, str]]] = {}
    for parent, child, ccol, pcol, action in rows:
        graph.setdefault(parent, []).append((child, ccol, pcol, action))
    return graph


async def purge_test_data(session: AsyncSession, attempts: int = 5) -> dict[str, int]:
    """Delete every test user and every row that depends on one.

    Requests the runner already got answers for may still have background
    work in flight (notifications are written after the response), which can
    insert a row between two DELETEs of the same purge. The FK then rejects
    the final delete and the whole transaction rolls back — so retry.
    """
    for attempt in range(attempts):
        try:
            return await _purge_once(session)
        except IntegrityError:
            await session.rollback()
            if attempt == attempts - 1:
                raise
            await asyncio.sleep(1 + attempt)
    raise AssertionError("unreachable")


async def _purge_once(session: AsyncSession) -> dict[str, int]:
    """One purge attempt.

    Walks the FK graph depth-first and deletes children before parents.
    NO ACTION / RESTRICT children would block the delete and CASCADE children
    may themselves be NO-ACTION-referenced (exchange -> chat -> reading
    buddy), so all three are descended into; SET NULL / SET DEFAULT are left
    to Postgres. Only rows reachable from test users are ever touched.
    One transaction: all or nothing.
    """
    # SQL is assembled only from the constant test-user filter and table /
    # column names read from pg_catalog — never from request input.
    graph = await _fk_children(session)
    counts: dict[str, int] = {}

    async def purge(table: str, where: str, depth: int) -> None:
        if depth > 12:
            raise RuntimeError(f"FK chain too deep at {table}")
        for child, ccol, pcol, action in graph.get(table, []):
            if action not in ("a", "r", "c"):
                continue
            if child == table:  # self-reference: handled by the DELETE below
                continue
            await purge(
                child,
                f'"{ccol}" IN (SELECT "{pcol}" FROM {table} WHERE {where})',  # noqa: S608
                depth + 1,
            )
        res = await session.execute(text(f"DELETE FROM {table} WHERE {where}"))  # noqa: S608
        if res.rowcount:
            counts[table] = counts.get(table, 0) + res.rowcount

    await purge("users", _TEST_USERS_SQL, 0)
    await session.commit()
    return counts


async def _create_test_users(
    session: AsyncSession, run: _Run
) -> tuple[list[dict[str, str]], dict[str, str]]:
    tag = run.id.hex[-8:]
    now = datetime.now(UTC)
    ttl = run.estimate_s * 2 + 600
    users: list[User] = []
    for i in range(run.cfg.users):
        u = User(
            email=f"lt-{tag}-{i}@{TEST_EMAIL_DOMAIN}",
            username=f"lt{tag}{i}",
            name=f"Yük Testi {i + 1}",
            email_verified_at=now,
            kvkk_consent_at=now,
            status=UserStatus.active,
        )
        session.add(u)
        users.append(u)
    await session.flush()
    # One real credential so the login (argon2) path can be measured.
    password = secrets.token_urlsafe(16)
    session.add(
        UserCredential(
            user_id=users[0].id, password_hash=await asyncio.to_thread(hash_password, password)
        )
    )
    await session.commit()
    tokens = [
        {"id": str(u.id), "token": create_access_token(str(u.id), expires_in_seconds=ttl)}
        for u in users
    ]
    return tokens, {"email": users[0].email, "password": password}


# ── Environment facts shown next to the numbers ─────────────────────────────


def _cpu_limit() -> float | None:
    try:
        quota, period = Path("/sys/fs/cgroup/cpu.max").read_text().split()
        return None if quota == "max" else round(int(quota) / int(period), 2)
    except OSError, ValueError:
        return None


async def _environment(session: AsyncSession) -> dict[str, Any]:
    settings = get_settings()
    pg = (
        await session.execute(
            text(
                "SELECT current_setting('server_version'), current_setting('max_connections'),"
                " pg_database_size(current_database()),"
                " (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database())"
            )
        )
    ).one()
    try:
        jit = sys._jit.is_active()  # type: ignore[attr-defined]
    except AttributeError:
        jit = None
    try:
        affinity = len(os.sched_getaffinity(0))
    except AttributeError:
        affinity = os.cpu_count()
    return {
        "python": platform.python_version(),
        "jit_active": jit,
        "cpus_visible": affinity,
        "cpu_limit": _cpu_limit(),
        "rss_mb": round(_rss_mb(), 1),
        "db_pool_size": settings.database_pool_size,
        "db_max_overflow": settings.database_max_overflow,
        "db_pool_pre_ping": settings.database_pool_pre_ping,
        "rate_limit_enabled": settings.rate_limit_enabled,
        "postgres": pg[0],
        "pg_max_connections": int(pg[1]),
        "db_size_mb": round(pg[2] / 2**20, 1),
        "pg_connections": int(pg[3]),
        "env": settings.env,
    }


# ── Result summary ──────────────────────────────────────────────────────────


def _grade(p: dict[str, Any]) -> str:
    if p["requests"] == 0 or p["error_rate"] >= 5 or p["p95_ms"] >= 1000:
        return "bad"
    if p["error_rate"] >= 1 or p["p95_ms"] >= 300:
        return "warn"
    return "good"


def _summarize(run: _Run, env_after: dict[str, Any]) -> dict[str, Any]:
    for p in run.phases:
        p["grade"] = _grade(p)
    total = sum(p["requests"] for p in run.phases)
    errors = sum(p["errors"] for p in run.phases)
    endpoint = [p for p in run.phases if p["phase"] in SCENARIOS]
    ramp = [p for p in run.phases if p["phase"].startswith("ramp@")]
    healthy = [p for p in ramp if p["error_rate"] < 1 and p["p95_ms"] < 1000]
    capacity = max(healthy, key=lambda p: p["ok_rps"], default=None)
    mixed = next((p for p in run.phases if p["phase"] == "mixed"), None)
    return {
        "total_requests": total,
        "total_errors": errors,
        "error_rate": round(errors / total * 100, 2) if total else 0.0,
        "grades": {
            g: sum(1 for p in run.phases if p.get("grade") == g) for g in ("good", "warn", "bad")
        },
        "mixed_rps": mixed["ok_rps"] if mixed else None,
        "mixed_p95_ms": mixed["p95_ms"] if mixed else None,
        "capacity": (
            {
                "concurrency": capacity["concurrency"],
                "rps": capacity["ok_rps"],
                "p95_ms": capacity["p95_ms"],
            }
            if capacity
            else None
        ),
        "slowest": [
            {"phase": p["phase"], "label": p["label"], "p95_ms": p["p95_ms"]}
            for p in sorted(endpoint, key=lambda p: -p["p95_ms"])[:3]
        ],
        "fastest": [
            {"phase": p["phase"], "label": p["label"], "rps": p["ok_rps"]}
            for p in sorted(endpoint, key=lambda p: -p["ok_rps"])[:3]
        ],
        "env_before": run.env_before,
        "env_after": env_after,
    }


# ── Orchestration ───────────────────────────────────────────────────────────


async def _close_live_websockets() -> int:
    """Drop real users' open chat sockets; their app reconnects after the test."""
    from app.modules.chat.service import _connections

    closed = 0
    for sockets in list(_connections.values()):
        for ws in list(sockets):
            with contextlib.suppress(Exception):
                await ws.close(code=1012, reason="maintenance")
                closed += 1
    return closed


async def _handle_event(run: _Run, ev: dict[str, Any]) -> None:
    kind = ev.get("event")
    if kind == "phase_start":
        run.sampler.reset()
        run.current = {
            "phase": ev["phase"],
            "label": ev["label"],
            "concurrency": ev["concurrency"],
            "duration": ev["duration"],
            "elapsed": 0,
            "requests": 0,
            "rps": 0,
        }
        if ev["phase"] == "setup":
            run.status = "setup"
        else:
            run.status = "running"
            run.note(f"▶ {ev['label']} ({ev['concurrency']} eşzamanlı)")
    elif kind == "progress" and run.current:
        run.current.update(elapsed=ev["elapsed"], requests=ev["requests"], rps=ev["rps"])
        run.series.append(
            {
                "t": round(time.monotonic() - run.started, 1),
                "phase": ev["phase"],
                "rps": ev["rps"],
            }
        )
    elif kind == "phase_end":
        result = ev["result"]
        result["server"] = run.sampler.snapshot()
        result["grade"] = _grade(result)
        run.phases.append(result)
        run.current = None
        run.note(
            f"✓ {result['label']}: {result['ok_rps']} ist/sn, p95 {result['p95_ms']} ms, "
            f"hata %{result['error_rate']}"
        )
    elif kind == "setup":
        run.setup = {k: v for k, v in ev.items() if k != "event"}
        run.current = None
        run.note(
            f"Test verisi hazır: {ev['books']} kitap, {ev['exchanges']} takas, {ev['chats']} sohbet"
        )
    elif kind == "skip":
        run.skipped.append({"phase": ev["phase"], "reason": ev["reason"]})
        run.note(f"Atlandı: {ev['phase']} — {ev['reason']}")
    elif kind == "ramp_stop":
        run.note(f"Rampa {ev['step']} eşzamanlıda durdu: {ev['reason']}")
    elif kind == "error":
        run.error = ev["message"]
        run.note(f"HATA: {ev['message']}")


async def _drive(run: _Run, users: list[dict[str, str]], login: dict[str, str]) -> None:
    port = int(os.environ.get("PORT", "8000"))
    cfg = run.cfg
    config = {
        "base": f"http://127.0.0.1:{port}",
        "key": run.key,
        "users": users,
        "login": login,
        "area": AREA,
        "scenarios": cfg.scenarios,
        "concurrency": cfg.concurrency,
        "duration": cfg.duration_s,
        "mixed": cfg.mixed,
        "ramp": {"enabled": cfg.ramp, "steps": cfg.ramp_steps, "duration": cfg.ramp_duration_s},
        "books_per_user": cfg.books_per_user,
    }
    env = {**os.environ, "PYTHONPATH": str(_BACKEND_ROOT)}
    run.proc = await asyncio.create_subprocess_exec(
        sys.executable,
        "-m",
        "app.modules.admin.loadtest_runner",
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        cwd=str(_BACKEND_ROOT),
        env=env,
        limit=2**22,  # a phase_end line carries error samples
    )
    assert run.proc.stdin and run.proc.stdout and run.proc.stderr
    run.proc.stdin.write((json.dumps(config) + "\n").encode())
    await run.proc.stdin.drain()
    run.proc.stdin.close()

    stderr_tail: deque[str] = deque(maxlen=30)

    async def read_stderr() -> None:
        assert run.proc and run.proc.stderr
        async for line in run.proc.stderr:
            stderr_tail.append(line.decode("utf-8", "replace").rstrip())

    err_task = asyncio.create_task(read_stderr())
    async for line in run.proc.stdout:
        try:
            ev = json.loads(line)
        except ValueError:
            continue
        await _handle_event(run, ev)
    code = await run.proc.wait()
    await err_task
    if code != 0 and not run.stop_requested and not run.error:
        run.error = f"Yük üreticisi {code} koduyla çıktı: " + " | ".join(list(stderr_tail)[-5:])


async def _execute(run: _Run) -> None:
    global _run
    factory = get_session_factory()
    final_status = "failed"
    scheduler_paused = False
    try:
        async with factory() as session:
            run.env_before = await _environment(session)
            leftovers = await count_leftovers(session)
            if leftovers:
                run.note(f"Önceki testten kalan {leftovers} test kullanıcısı temizleniyor…")
                await purge_test_data(session)
            users, login = await _create_test_users(session, run)
            admin_ids = set(
                (await session.execute(select(User.id).where(User.is_admin.is_(True)))).scalars()
            )
        run.note(f"{len(users)} test kullanıcısı oluşturuldu")

        # Hard cap well above the estimate: maintenance ends by itself even
        # if this task dies.
        maintenance.begin(
            run.key, run.estimate_s * 1.5 + 180, admin_ids | {run.admin_id}, "loadtest"
        )
        run.note("Bakım modu AÇIK — kullanıcılar geçici olarak 503 alıyor")
        if _scheduler is not None:
            with contextlib.suppress(Exception):
                _scheduler.pause()
                scheduler_paused = True
        closed = await _close_live_websockets()
        if closed:
            run.note(f"{closed} açık WebSocket bağlantısı kapatıldı")

        run.sampler.start()
        await _drive(run, users, login)
        if run.stop_requested:
            final_status = "stopped"
        elif run.error:
            final_status = "failed"
        else:
            final_status = "completed"
    except asyncio.CancelledError:
        final_status = "stopped"
        raise
    except Exception as exc:
        logger.exception("load test failed")
        run.error = f"{type(exc).__name__}: {exc}"
        run.note(f"HATA: {run.error}")
    finally:
        await run.sampler.stop()
        if run.proc and run.proc.returncode is None:
            with contextlib.suppress(ProcessLookupError):
                run.proc.kill()
        run.status = "cleanup"
        run.note("Test verisi siliniyor…")
        env_after: dict[str, Any] = {}
        async with factory() as session:
            try:
                run.cleanup = await purge_test_data(session)
                run.note(f"Temizlendi: {sum(run.cleanup.values())} satır")
            except Exception as exc:
                await session.rollback()
                logger.exception("load test cleanup failed")
                run.error = (run.error or "") + f" | Temizlik hatası: {exc}"
                run.note(
                    f"Temizlik HATASI: {exc} — 'Kalan test verisini temizle' ile tekrar deneyin"
                )
        maintenance.end()
        run.note("Bakım modu KAPALI")
        if scheduler_paused:
            with contextlib.suppress(Exception):
                _scheduler.resume()
        async with factory() as session:
            with contextlib.suppress(Exception):
                env_after = await _environment(session)
            summary = _summarize(run, env_after)
            row = await session.get(LoadTestRun, run.id)
            if row is not None:
                row.status = final_status
                row.finished_at = datetime.now(UTC)
                row.error = (run.error or None) and run.error[:2000]
                row.result = {
                    "summary": summary,
                    "phases": run.phases,
                    "setup": run.setup,
                    "skipped": run.skipped,
                    "cleanup": run.cleanup,
                    "log": list(run.log),
                    "duration_s": round(time.monotonic() - run.started, 1),
                }
            await log_event(
                session,
                "loadtest_finished",
                user_id=run.admin_id,
                metadata={
                    "run_id": str(run.id),
                    "status": final_status,
                    "requests": summary["total_requests"],
                    "error_rate": summary["error_rate"],
                },
            )
            await session.commit()
        run.status = final_status
        _run = None


async def recover_after_restart() -> None:
    """Startup hook: a restart mid-run leaves test users and a 'running' row."""
    try:
        async with get_session_factory()() as session:
            await session.execute(
                LoadTestRun.__table__.update()
                .where(LoadTestRun.status == "running")
                .values(status="interrupted", finished_at=datetime.now(UTC))
            )
            await session.commit()
            if await count_leftovers(session):
                counts = await purge_test_data(session)
                logger.warning("Purged load-test leftovers after restart: %s", counts)
    except Exception:
        logger.exception("load-test recovery failed")


# ── Endpoints ───────────────────────────────────────────────────────────────


def _run_row(r: LoadTestRun, full: bool = False) -> dict[str, Any]:
    result = r.result or {}
    data: dict[str, Any] = {
        "id": str(r.id),
        "status": r.status,
        "started_at": r.started_at,
        "finished_at": r.finished_at,
        "started_by": str(r.started_by) if r.started_by else None,
        "config": r.config,
        "error": r.error,
        "summary": result.get("summary"),
        "duration_s": result.get("duration_s"),
    }
    if full:
        data.update(
            phases=result.get("phases", []),
            setup=result.get("setup"),
            skipped=result.get("skipped", []),
            cleanup=result.get("cleanup"),
            log=result.get("log", []),
        )
    return data


@router.get("/catalog")
async def catalog(_: User = Depends(get_admin_user)) -> dict[str, Any]:
    groups = {"read": "Okuma", "write": "Yazma", "auth": "Giriş", "ws": "WebSocket"}
    return {
        "scenarios": [
            {"name": s.name, "label": s.label, "group": s.group, "group_label": groups[s.group]}
            for s in SCENARIOS.values()
        ],
        "profiles": PROFILES,
        "defaults": LoadTestStartRequest().model_dump(exclude={"confirm_maintenance"}),
        "max_total_s": MAX_TOTAL_SECONDS,
    }


@router.get("/status")
async def status(
    _: User = Depends(get_admin_user), session: AsyncSession = Depends(get_session)
) -> dict[str, Any]:
    return {
        "running": _run is not None,
        "run": _run.live() if _run else None,
        "maintenance": maintenance.is_active(),
        "leftover_test_users": await count_leftovers(session),
    }


@router.post("/estimate")
async def estimate(body: LoadTestStartRequest, _: User = Depends(get_admin_user)) -> dict[str, int]:
    return {"estimate_s": _estimate_seconds(body), "max_total_s": MAX_TOTAL_SECONDS}


@router.post("/start", status_code=202)
async def start(
    body: LoadTestStartRequest,
    admin: User = Depends(get_admin_user),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    global _run
    if _run is not None:
        raise HTTPException(409, "Zaten çalışan bir yük testi var")
    if not body.confirm_maintenance:
        raise HTTPException(400, "Bakım modunu onaylamanız gerekiyor (confirm_maintenance)")
    unknown = [s for s in body.scenarios if s not in SCENARIOS]
    if unknown:
        raise HTTPException(422, f"Bilinmeyen senaryo: {', '.join(unknown)}")
    if not body.scenarios and not body.mixed and not body.ramp:
        raise HTTPException(422, "En az bir senaryo seçin")
    body.ramp_steps = sorted({s for s in body.ramp_steps if 1 <= s <= 512})[:10]
    est = _estimate_seconds(body)
    if est > MAX_TOTAL_SECONDS:
        raise HTTPException(
            422,
            f"Tahmini süre {est} sn, üst sınır {MAX_TOTAL_SECONDS} sn — süreyi/senaryoları azaltın",
        )

    row = LoadTestRun(
        id=uuid.uuid7(),
        started_by=admin.id,
        status="running",
        config=body.model_dump(exclude={"confirm_maintenance"}),
    )
    session.add(row)
    await log_event(
        session,
        "loadtest_started",
        user_id=admin.id,
        metadata={"run_id": str(row.id), "estimate_s": est, "profile": body.profile},
    )
    await session.commit()

    run = _Run(row.id, admin.id, body)
    run.note(f"Yük testi başlatıldı — tahmini süre {est} sn")
    _run = run
    run.task = asyncio.create_task(_execute(run))
    return {"id": str(row.id), "estimate_s": est}


@router.post("/stop")
async def stop(_: User = Depends(get_admin_user)) -> dict[str, Any]:
    run = _run
    if run is None:
        raise HTTPException(404, "Çalışan yük testi yok")
    run.stop_requested = True
    run.note("Durdurma istendi")
    if run.proc and run.proc.returncode is None:
        with contextlib.suppress(ProcessLookupError):
            run.proc.send_signal(signal.SIGTERM)
    return {"stopping": True}


@router.post("/cleanup")
async def cleanup(
    _: User = Depends(get_admin_user), session: AsyncSession = Depends(get_session)
) -> dict[str, Any]:
    if _run is not None:
        raise HTTPException(409, "Test çalışırken temizlik yapılamaz")
    counts = await purge_test_data(session)
    return {"deleted": counts, "total": sum(counts.values())}


@router.get("/runs")
async def list_runs(
    limit: int = Query(default=20, ge=1, le=100),
    _: User = Depends(get_admin_user),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    rows = (
        await session.execute(
            select(LoadTestRun).order_by(LoadTestRun.started_at.desc()).limit(limit)
        )
    ).scalars()
    total = (await session.execute(select(func.count()).select_from(LoadTestRun))).scalar()
    return {"items": [_run_row(r) for r in rows], "total": total}


@router.get("/runs/{run_id}")
async def get_run(
    run_id: uuid.UUID,
    _: User = Depends(get_admin_user),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    row = await session.get(LoadTestRun, run_id)
    if row is None:
        raise HTTPException(404, "Kayıt bulunamadı")
    return _run_row(row, full=True)


@router.delete("/runs/{run_id}", status_code=204)
async def delete_run(
    run_id: uuid.UUID,
    _: User = Depends(get_admin_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    if _run is not None and _run.id == run_id:
        raise HTTPException(409, "Çalışan test silinemez")
    await session.execute(delete(LoadTestRun).where(LoadTestRun.id == run_id))
    await session.commit()
