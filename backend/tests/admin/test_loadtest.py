"""Admin load test: maintenance mode, test-data purge, and a full live run."""

import asyncio
import contextlib
import socket
import time
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from datetime import UTC, datetime
from typing import Any

import httpx
import pytest
import pytest_asyncio
import uvicorn
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import maintenance
from app.core.config import get_settings
from app.core.security import create_access_token
from app.main import create_app
from app.modules.admin import loadtest
from app.modules.admin.loadtest_runner import SCENARIOS
from app.modules.auth.models import User
from app.modules.books.models import Book

# ── Maintenance middleware ──────────────────────────────────────────────────


@pytest.fixture
def _maintenance_off() -> Any:
    yield
    maintenance.end()


@pytest.mark.asyncio
async def test_maintenance_blocks_everyone_but_admins_and_test_traffic(
    client: httpx.AsyncClient,
    register_user: Callable[[str, str], Awaitable[dict[str, Any]]],
    make_admin: Callable[[str], Awaitable[None]],
    _maintenance_off: Any,
) -> None:
    user = await register_user("real@example.com", "Real")
    admin = await register_user("boss@example.com", "Boss")
    await make_admin(admin["user_id"])

    maintenance.begin("s3cret", 60, {uuid.UUID(admin["user_id"])}, "test")

    blocked = await client.get("/api/v1/auth/me", headers=user["headers"])
    assert blocked.status_code == 503
    assert blocked.json()["maintenance"] is True
    assert int(blocked.headers["retry-after"]) > 0
    assert (await client.get("/api/v1/books/search")).status_code == 503

    assert (await client.get("/api/v1/auth/me", headers=admin["headers"])).status_code == 200
    keyed = await client.get(
        "/api/v1/auth/me", headers={**user["headers"], "X-Loadtest-Key": "s3cret"}
    )
    assert keyed.status_code == 200
    wrong = await client.get("/api/v1/auth/me", headers={**user["headers"], "X-Loadtest-Key": "x"})
    assert wrong.status_code == 503
    assert (await client.get("/api/v1/health")).status_code != 503

    maintenance.end()
    assert (await client.get("/api/v1/auth/me", headers=user["headers"])).status_code == 200


def test_maintenance_expires_by_itself(_maintenance_off: Any) -> None:
    maintenance.begin("k", 0.05, set(), "test")
    assert maintenance.is_active()
    time.sleep(0.1)
    assert not maintenance.is_active()


@pytest.mark.asyncio
async def test_loadtest_endpoints_are_admin_only(
    client: httpx.AsyncClient,
    register_user: Callable[[str, str], Awaitable[dict[str, Any]]],
) -> None:
    user = await register_user("plain@example.com", "Plain")
    for method, path in [
        ("GET", "/api/v1/admin/loadtest/status"),
        ("GET", "/api/v1/admin/loadtest/catalog"),
        ("GET", "/api/v1/admin/loadtest/runs"),
        ("POST", "/api/v1/admin/loadtest/start"),
        ("POST", "/api/v1/admin/loadtest/cleanup"),
    ]:
        resp = await client.request(method, path, headers=user["headers"], json={})
        assert resp.status_code == 403, path


@pytest.mark.asyncio
async def test_start_requires_maintenance_confirmation(
    client: httpx.AsyncClient,
    register_user: Callable[[str, str], Awaitable[dict[str, Any]]],
    make_admin: Callable[[str], Awaitable[None]],
) -> None:
    admin = await register_user("boss@example.com", "Boss")
    await make_admin(admin["user_id"])
    resp = await client.post("/api/v1/admin/loadtest/start", headers=admin["headers"], json={})
    assert resp.status_code == 400
    too_long = await client.post(
        "/api/v1/admin/loadtest/start",
        headers=admin["headers"],
        json={"duration_s": 60, "ramp_duration_s": 60, "confirm_maintenance": True},
    )
    assert too_long.status_code == 422


# ── Purge: only test users' rows go, real data stays ────────────────────────


async def _test_user(session: AsyncSession, n: int) -> tuple[User, dict[str, str]]:
    u = User(
        email=f"lt-0000abcd-{n}@{loadtest.TEST_EMAIL_DOMAIN}",
        username=f"ltx{n}",
        name=f"LT {n}",
        email_verified_at=datetime.now(UTC),
    )
    session.add(u)
    await session.commit()
    return u, {"Authorization": f"Bearer {create_access_token(str(u.id))}"}


def _book(title: str) -> dict[str, Any]:
    return {
        "title": title,
        "category": "fiction",
        "condition": "good",
        "location": {"lat": 41.0, "lng": 29.0},
    }


@pytest.mark.asyncio
async def test_purge_removes_test_rows_and_keeps_real_data(
    client: httpx.AsyncClient,
    db_session: AsyncSession,
    register_user: Callable[[str, str], Awaitable[dict[str, Any]]],
) -> None:
    real = await register_user("real@example.com", "Real")
    await db_session.execute(
        User.__table__.update()
        .where(User.id == uuid.UUID(real["user_id"]))
        .values(email_verified_at=datetime.now(UTC))
    )
    await db_session.commit()
    real_book = (
        await client.post("/api/v1/books", json=_book("Gerçek"), headers=real["headers"])
    ).json()

    t1, h1 = await _test_user(db_session, 1)
    t2, h2 = await _test_user(db_session, 2)
    tb = (await client.post("/api/v1/books", json=_book("Test"), headers=h2)).json()
    # Test rows that point at REAL rows (favorite / exchange on a real book)
    # and at each other (exchange + chat + messages between test users).
    assert (
        await client.post(f"/api/v1/books/{real_book['id']}/favorite", headers=h1)
    ).status_code in (200, 204)
    ex = await client.post(
        "/api/v1/exchanges", json={"book_id": tb["id"], "initial_message": "selam"}, headers=h1
    )
    assert ex.status_code == 201, ex.text
    assert (
        await client.post(f"/api/v1/exchanges/{ex.json()['id']}/accept", headers=h2)
    ).status_code == 200
    ex2 = await client.post(
        "/api/v1/exchanges",
        json={"book_id": real_book["id"], "initial_message": "merhaba"},
        headers=h2,
    )
    assert ex2.status_code == 201, ex2.text

    assert await loadtest.count_leftovers(db_session) == 2
    counts = await loadtest.purge_test_data(db_session)
    assert counts["users"] == 2
    assert counts.get("books", 0) >= 1
    assert await loadtest.count_leftovers(db_session) == 0

    # Real user and their book survive.
    assert await db_session.get(User, uuid.UUID(real["user_id"])) is not None
    assert await db_session.get(Book, uuid.UUID(real_book["id"])) is not None
    me = await client.get("/api/v1/auth/me", headers=real["headers"])
    assert me.status_code == 200


# ── Full run against a live server ──────────────────────────────────────────


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest_asyncio.fixture
async def live_server(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> AsyncIterator[str]:
    from app.modules.chat.service import subscribe_and_listen

    port = _free_port()
    monkeypatch.setenv("PORT", str(port))
    # The lifespan's MinIO bucket check would hang on the docker-only
    # hostname from .env; test books carry no photos.
    monkeypatch.setattr(get_settings(), "s3_bucket", "")
    server = uvicorn.Server(
        uvicorn.Config(create_app(), host="127.0.0.1", port=port, log_level="warning")
    )
    serve = asyncio.create_task(server.serve())
    # Chat delivery goes through Redis pub/sub (lifespan skips it in tests).
    listener = asyncio.create_task(subscribe_and_listen())
    for _ in range(200):
        if server.started or serve.done():
            break
        await asyncio.sleep(0.05)
    if not server.started:
        listener.cancel()
        exc = serve.exception() if serve.done() else None
        raise RuntimeError(f"live server failed to start: {exc!r}")
    yield f"http://127.0.0.1:{port}"
    listener.cancel()
    server.should_exit = True
    with contextlib.suppress(asyncio.CancelledError):
        await listener
    await serve
    maintenance.end()


@pytest.mark.asyncio
async def test_full_load_test_run(live_server: str, db_session: AsyncSession) -> None:
    async with httpx.AsyncClient(base_url=live_server, timeout=30) as http:
        reg = await http.post(
            "/api/v1/auth/register",
            json={
                "email": "admin@example.com",
                "password": "securepass123",
                "name": "Admin",
                "kvkk_consent": True,
            },
        )
        admin_id = uuid.UUID(reg.json()["user_id"])
        await db_session.execute(
            User.__table__.update().where(User.id == admin_id).values(is_admin=True)
        )
        await db_session.commit()
        admin = {"Authorization": f"Bearer {reg.json()['access_token']}"}
        real = await http.post(
            "/api/v1/auth/register",
            json={
                "email": "user@example.com",
                "password": "securepass123",
                "name": "User",
                "kvkk_consent": True,
            },
        )
        user = {"Authorization": f"Bearer {real.json()['access_token']}"}

        start = await http.post(
            "/api/v1/admin/loadtest/start",
            headers=admin,
            json={
                "concurrency": 4,
                "duration_s": 3,
                "users": 3,
                "books_per_user": 1,
                "ramp_steps": [2, 4],
                "ramp_duration_s": 3,
                "confirm_maintenance": True,
            },
        )
        assert start.status_code == 202, start.text
        again = await http.post(
            "/api/v1/admin/loadtest/start", headers=admin, json={"confirm_maintenance": True}
        )
        assert again.status_code == 409

        saw_block = False
        deadline = time.monotonic() + 300
        while time.monotonic() < deadline:
            st = (await http.get("/api/v1/admin/loadtest/status", headers=admin)).json()
            if st["running"] and st["run"]["status"] == "running" and not saw_block:
                blocked = await http.get("/api/v1/auth/me", headers=user)
                assert blocked.status_code == 503
                saw_block = True
            if not st["running"]:
                break
            await asyncio.sleep(0.5)
        assert saw_block, "never observed maintenance mode while running"
        assert not st["running"], "load test did not finish in time"
        assert st["maintenance"] is False
        assert st["leftover_test_users"] == 0

        runs = (await http.get("/api/v1/admin/loadtest/runs", headers=admin)).json()
        detail = (
            await http.get(f"/api/v1/admin/loadtest/runs/{runs['items'][0]['id']}", headers=admin)
        ).json()
        assert detail["status"] == "completed", (
            detail["error"],
            detail["log"],
            [(p["phase"], p["statuses"], p["error_samples"][:1]) for p in detail["phases"]],
        )
        phases = {p["phase"]: p for p in detail["phases"]}
        # Every scenario ran and every request succeeded.
        failures = {
            name: (p["statuses"], p["error_samples"])
            for name, p in phases.items()
            if p["errors"] or p["requests"] == 0
        }
        assert not failures, failures
        assert set(SCENARIOS) <= set(phases), set(SCENARIOS) - set(phases)
        assert "mixed" in phases and "ramp@2" in phases
        assert phases["ws_chat"]["requests"] > 0
        assert phases["mixed"]["server"]["pool_checked_out_max"] >= 1
        assert detail["summary"]["total_requests"] > 0
        assert detail["cleanup"]["users"] == 3

        # The real user is back in and untouched.
        assert (await http.get("/api/v1/auth/me", headers=user)).status_code == 200
        remaining = (
            await db_session.execute(
                select(func.count()).select_from(User).where(User.email.like("%@loadtest.%"))
            )
        ).scalar()
        assert remaining == 0


@pytest.mark.asyncio
async def test_registration_refuses_the_load_test_domain(client: httpx.AsyncClient) -> None:
    resp = await client.post(
        "/api/v1/auth/register",
        json={
            "email": f"lt-0000abcd-1@{loadtest.TEST_EMAIL_DOMAIN}",
            "password": "securepass123",
            "name": "Sneaky",
            "kvkk_consent": True,
        },
    )
    assert resp.status_code == 422
