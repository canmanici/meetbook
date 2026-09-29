"""Teacher-issued student codes: the demo-stage replacement for .edu.tr mail."""

import uuid
from datetime import UTC, datetime, timedelta

import httpx
import pytest
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.teachers.models import StudentCode
from tests.teachers.test_teachers import _apply, _pending_id

pytestmark = pytest.mark.asyncio


async def _approved_teacher(client, register_user, make_admin, suffix: str) -> tuple[dict, dict]:
    teacher = await register_user(f"hoca_{suffix}@gmail.com", "Hoca")
    admin = await register_user(f"admin_{suffix}@example.com", "Admin")
    await make_admin(admin["user_id"])
    await _apply(client, teacher)
    app_id = await _pending_id(client, admin)
    resp = await client.post(
        f"/api/v1/admin/teachers/{app_id}/approve", json={"note": "ok"}, headers=admin["headers"]
    )
    assert resp.status_code == 204
    return teacher, admin


async def _issue(client: httpx.AsyncClient, teacher: dict, count: int = 1) -> httpx.Response:
    return await client.post(
        "/api/v1/teachers/codes", json={"count": count}, headers=teacher["headers"]
    )


async def _redeem(client: httpx.AsyncClient, user: dict, code: str) -> httpx.Response:
    return await client.post(
        "/api/v1/students/verify-code", json={"code": code}, headers=user["headers"]
    )


async def test_student_redeems_a_teacher_code_and_gets_the_starter_credit(
    client, register_user, make_admin
) -> None:
    teacher, _ = await _approved_teacher(client, register_user, make_admin, "a")
    student = await register_user("ogrenci_a@gmail.com", "Öğrenci")

    resp = await _issue(client, teacher, 2)
    assert resp.status_code == 201
    body = resp.json()
    assert body["active_count"] == 2
    code = body["items"][0]["code"]
    assert len(code) == 9 and code[4] == "-"

    # Typed loosely: lower-case, no dash.
    assert (await _redeem(client, student, code.replace("-", "").lower())).status_code == 204
    wallet = (await client.get("/api/v1/credits/me", headers=student["headers"])).json()
    assert wallet["edu_verified"] is True
    assert wallet["balance"] == 1
    assert wallet["floor"] == -2

    codes = (await client.get("/api/v1/teachers/codes", headers=teacher["headers"])).json()
    assert sorted(c["status"] for c in codes["items"]) == ["active", "redeemed"]


async def test_a_code_works_once(client, register_user, make_admin) -> None:
    teacher, _ = await _approved_teacher(client, register_user, make_admin, "b")
    first = await register_user("s1_b@gmail.com", "S1")
    second = await register_user("s2_b@gmail.com", "S2")
    code = (await _issue(client, teacher)).json()["items"][0]["code"]
    assert (await _redeem(client, first, code)).status_code == 204
    resp = await _redeem(client, second, code)
    assert resp.status_code == 400
    assert resp.json()["detail"] == "INVALID_STUDENT_CODE"


async def test_expired_revoked_unknown_and_own_codes_all_fail_the_same_way(
    client, register_user, make_admin, db_session: AsyncSession
) -> None:
    teacher, _ = await _approved_teacher(client, register_user, make_admin, "c")
    student = await register_user("s_c@gmail.com", "S")
    items = (await _issue(client, teacher, 3)).json()["items"]
    expired, revoked, own = items[0], items[1], items[2]

    await db_session.execute(
        update(StudentCode)
        .where(StudentCode.id == uuid.UUID(expired["id"]))
        .values(expires_at=datetime.now(UTC) - timedelta(minutes=1))
    )
    await db_session.commit()
    await client.post(f"/api/v1/teachers/codes/{revoked['id']}/revoke", headers=teacher["headers"])

    for code in (expired["code"], revoked["code"], "ZZZZ-ZZZZ"):
        resp = await _redeem(client, student, code)
        assert resp.status_code == 400
        assert resp.json()["detail"] == "INVALID_STUDENT_CODE"
    # A teacher can't verify themselves with their own code.
    resp = await _redeem(client, teacher, own["code"])
    assert resp.json()["detail"] == "INVALID_STUDENT_CODE"


async def test_only_approved_teachers_issue_codes_and_at_most_30_open(
    client, register_user, make_admin
) -> None:
    nobody = await register_user("nobody@gmail.com", "Nobody")
    resp = await _issue(client, nobody)
    assert resp.status_code == 403
    assert resp.json()["detail"] == "NOT_TEACHER"

    teacher, _ = await _approved_teacher(client, register_user, make_admin, "d")
    for _ in range(3):
        assert (await _issue(client, teacher, 10)).status_code == 201
    resp = await _issue(client, teacher, 1)
    assert resp.status_code == 409
    assert resp.json()["detail"] == "CODE_LIMIT"


async def test_revoking_the_badge_kills_open_codes(client, register_user, make_admin) -> None:
    teacher, admin = await _approved_teacher(client, register_user, make_admin, "e")
    student = await register_user("s_e@gmail.com", "S")
    code = (await _issue(client, teacher)).json()["items"][0]["code"]

    listing = (await client.get("/api/v1/admin/teachers", headers=admin["headers"])).json()
    assert listing["items"][0]["codes_issued"] == 1
    await client.post(
        f"/api/v1/admin/teachers/{listing['items'][0]['id']}/revoke",
        json={"note": "Kodları sattı"},
        headers=admin["headers"],
    )
    resp = await _redeem(client, student, code)
    assert resp.json()["detail"] == "INVALID_STUDENT_CODE"


async def test_already_verified_student_cannot_take_a_second_code(
    client, register_user, make_admin
) -> None:
    teacher, _ = await _approved_teacher(client, register_user, make_admin, "f")
    student = await register_user("s_f@gmail.com", "S")
    first, second = (await _issue(client, teacher, 2)).json()["items"]
    assert (await _redeem(client, student, first["code"])).status_code == 204
    resp = await _redeem(client, student, second["code"])
    assert resp.status_code == 409
    assert resp.json()["detail"] == "ALREADY_STUDENT"
    # The second code was not burned.
    codes = (await client.get("/api/v1/teachers/codes", headers=teacher["headers"])).json()
    assert codes["active_count"] == 1
