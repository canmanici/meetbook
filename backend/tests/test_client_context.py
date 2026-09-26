"""Client context: real IP, verbose device profile, persisted on sessions/audit."""

import base64
import json
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.core.client_context import _parse_client_info, context_from_scope
from app.modules.auth.models import AuditLog, RefreshToken


def _b64(d: dict[str, Any]) -> str:
    return base64.urlsafe_b64encode(json.dumps(d).encode()).decode().rstrip("=")


def _scope(peer: str, headers: dict[str, str]) -> dict[str, Any]:
    return {
        "type": "http",
        "client": (peer, 1234),
        "headers": [(k.lower().encode(), v.encode()) for k, v in headers.items()],
    }


def test_real_ip_comes_from_proxy_hop_not_docker_peer() -> None:
    ctx = context_from_scope(_scope("10.0.1.12", {"x-forwarded-for": "1.2.3.4, 88.230.1.1"}))
    assert ctx.ip == "88.230.1.1"  # rightmost = what Traefik saw; leftmost is spoofable


def test_forwarded_for_ignored_from_public_peer() -> None:
    ctx = context_from_scope(_scope("8.8.4.4", {"x-forwarded-for": "88.230.1.1"}))
    assert ctx.ip == "8.8.4.4"


def test_verbose_profile_is_whitelisted_and_capped() -> None:
    info = _parse_client_info(
        _b64(
            {
                "brand": "samsung",
                "model_name": "Galaxy S23 Ultra",
                "product_name": "dm3qxxx",
                "total_memory_mb": 11480,
                "is_physical_device": True,
                "cpu_archs": ["arm64-v8a"],
                "device_name": "Can’ın Telefonu",
                "evil": "<script>",
                "os_version": "x" * 500,
            }
        )
    )
    assert info is not None
    assert "evil" not in info
    assert info["device_name"] == "Can’ın Telefonu"
    assert len(info["os_version"]) == 160
    assert _parse_client_info("not-base64!!") is None
    assert _parse_client_info("A" * 5000) is None


def test_device_summary_prefers_verbose_profile() -> None:
    ctx = context_from_scope(
        _scope(
            "127.0.0.1",
            {
                "x-client-platform": "android",
                "x-client-app-version": "1.1.61+61",
                "x-client-info": _b64(
                    {
                        "brand": "samsung",
                        "model_name": "Galaxy S23 Ultra",
                        "product_name": "dm3qxxx",
                        "os_version": "14",
                        "api_level": 34,
                    }
                ),
            },
        )
    )
    d = ctx.device()
    assert d["os"] == "Android"
    assert d["device_model"] == "samsung Galaxy S23 Ultra"
    assert d["model_code"] == "dm3qxxx"
    assert d["api_level"] == 34
    assert d["app_version"] == "1.1.61+61"


async def test_login_records_ip_and_device_on_session_and_audit(
    client: httpx.AsyncClient, db_engine: Any
) -> None:
    await client.post(
        "/api/v1/auth/register",
        json={
            "email": "ctx@example.com",
            "password": "securepass123",
            "name": "Ctx",
            "kvkk_consent": True,
        },
    )
    headers = {
        # ASGI test peer is 127.0.0.1 (internal), so the proxy hop is honoured.
        "x-forwarded-for": "88.230.1.1",
        "user-agent": "okhttp/4.12.0",
        "x-client-platform": "android",
        "x-client-info": _b64(
            {"brand": "Xiaomi", "model_name": "Redmi Note 12", "os_version": "13"}
        ),
    }
    resp = await client.post(
        "/api/v1/auth/login",
        json={"email": "ctx@example.com", "password": "securepass123"},
        headers=headers,
    )
    assert resp.status_code == 200, resp.text

    async with async_sessionmaker(db_engine)() as s:
        tokens = (await s.execute(select(RefreshToken))).scalars().all()
        login_token = [t for t in tokens if t.ip_address is not None][-1]
        assert str(login_token.ip_address) == "88.230.1.1"
        assert login_token.device_info["device_model"] == "Xiaomi Redmi Note 12"
        assert login_token.user_agent == "okhttp/4.12.0"
        audit = (
            (await s.execute(select(AuditLog).where(AuditLog.event_type == "login_success")))
            .scalars()
            .all()
        )
        assert str(audit[-1].ip_address) == "88.230.1.1"
        assert audit[-1].metadata_["client"]["device"]["os"] == "Android"


async def test_admin_sees_login_history_and_new_user_origin(
    client: httpx.AsyncClient, db_engine: Any
) -> None:
    from sqlalchemy import update

    from app.modules.auth.models import User

    for email in ("boss@example.com", "newbie@example.com"):
        await client.post(
            "/api/v1/auth/register",
            json={
                "email": email,
                "password": "securepass123",
                "name": email[:4],
                "kvkk_consent": True,
            },
            headers={
                "x-forwarded-for": "88.230.1.1",
                "x-client-info": _b64(
                    {"platform": "ios", "model_name": "iPhone 15 Pro", "model_id": "iPhone16,1"}
                ),
            },
        )
    async with async_sessionmaker(db_engine)() as s:
        await s.execute(update(User).where(User.email == "boss@example.com").values(is_admin=True))
        await s.commit()
        newbie_id = (
            await s.execute(select(User.id).where(User.email == "newbie@example.com"))
        ).scalar_one()

    # one failed + one good login for the newbie
    await client.post(
        "/api/v1/auth/login",
        json={"email": "newbie@example.com", "password": "wrongpass1"},
        headers={"x-forwarded-for": "176.88.0.1"},
    )
    await client.post(
        "/api/v1/auth/login",
        json={"email": "newbie@example.com", "password": "securepass123"},
        headers={"x-forwarded-for": "176.88.0.1"},
    )
    token = (
        await client.post(
            "/api/v1/auth/login", json={"email": "boss@example.com", "password": "securepass123"}
        )
    ).json()["access_token"]
    auth = {"Authorization": f"Bearer {token}"}

    r = await client.get(f"/api/v1/admin/users/{newbie_id}/logins", headers=auth)
    assert r.status_code == 200, r.text
    body = r.json()
    kinds = {i["kind"] for i in body["items"]}
    assert {"session", "register_success", "login_failed", "login_success"} <= kinds
    assert body["summary"]["distinct_ips"] == 2
    assert body["summary"]["last_ip"] == "176.88.0.1"

    r = await client.get("/api/v1/admin/metrics/new-users?days=7", headers=auth)
    assert r.status_code == 200, r.text
    newbie = next(i for i in r.json()["items"] if i["email"] == "newbie@example.com")
    assert newbie["signup_ip"] == "88.230.1.1"
    assert newbie["device"]["model_code"] == "iPhone16,1"
    assert newbie["device"]["os"] == "iOS"

    # non-admins are refused
    user_tok = (
        await client.post(
            "/api/v1/auth/login", json={"email": "newbie@example.com", "password": "securepass123"}
        )
    ).json()["access_token"]
    r = await client.get(
        "/api/v1/admin/metrics/new-users", headers={"Authorization": f"Bearer {user_tok}"}
    )
    assert r.status_code == 403
