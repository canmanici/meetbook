"""Teacher activation by an e-mailed code, admin-issued student codes with a
chosen expiry, brute-force limits, and the e-mail verification switch."""

import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.modules.teachers.models import TeacherApplication
from tests.teachers.test_teachers import APPLICATION, _apply, _pending_id

pytestmark = pytest.mark.asyncio


async def _admin(client, register_user, make_admin, tag: str) -> dict:
    admin = await register_user(f"admin_{tag}@example.com", "Admin")
    await make_admin(admin["user_id"])
    return admin


async def _issue_activation(client, admin: dict, app_id: str, days: int = 7):
    return await client.post(
        f"/api/v1/admin/teachers/{app_id}/activation-code",
        json={"expires_in_days": days},
        headers=admin["headers"],
    )


async def test_applicant_becomes_teacher_with_the_emailed_code(
    client, register_user, make_admin, db_session: AsyncSession
) -> None:
    admin = await _admin(client, register_user, make_admin, "act1")
    teacher = await register_user("hoca_act1@gmail.com", "Hoca")
    await _apply(client, teacher)
    app_id = await _pending_id(client, admin)

    resp = await _issue_activation(client, admin, app_id)
    assert resp.status_code == 200
    issued = resp.json()
    assert issued["work_email"] == APPLICATION["work_email"]
    # Shown once: only a hash is stored.
    row = (
        await db_session.execute(
            select(TeacherApplication).where(TeacherApplication.id == uuid.UUID(app_id))
        )
    ).scalar_one()
    assert (
        row.activation_code_hash and issued["code"].replace("-", "") not in row.activation_code_hash
    )

    status = (await client.get("/api/v1/teachers/me", headers=teacher["headers"])).json()
    assert status["activation_code_sent"] is True

    resp = await client.post(
        "/api/v1/teachers/activate",
        json={"code": issued["code"].lower()},
        headers=teacher["headers"],
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["is_teacher"] is True
    # Approved by the admin who issued the code.
    listing = (await client.get("/api/v1/admin/teachers", headers=admin["headers"])).json()
    assert listing["items"][0]["status"] == "approved"


async def test_code_is_bound_to_the_account_that_applied(client, register_user, make_admin) -> None:
    """An attacker who applied with a real teacher's address never sees the
    code; and a code can't be used from any other account either."""
    admin = await _admin(client, register_user, make_admin, "act2")
    applicant = await register_user("claims_hoca@gmail.com", "Applicant")
    other = await register_user("other_act2@gmail.com", "Other")
    await _apply(client, applicant)
    await _apply(client, other)
    pending = (
        await client.get(
            "/api/v1/admin/teachers", params={"status": "pending"}, headers=admin["headers"]
        )
    ).json()["items"]
    applicant_app = next(a for a in pending if a["user_email"] == "claims_hoca@gmail.com")
    code = (await _issue_activation(client, admin, applicant_app["id"])).json()["code"]

    resp = await client.post(
        "/api/v1/teachers/activate", json={"code": code}, headers=other["headers"]
    )
    assert resp.status_code == 400
    assert resp.json()["detail"] == "TEACHER_CODE_INVALID"


async def test_activation_code_dies_after_five_wrong_tries(
    client, register_user, make_admin
) -> None:
    admin = await _admin(client, register_user, make_admin, "act3")
    teacher = await register_user("hoca_act3@gmail.com", "Hoca")
    await _apply(client, teacher)
    code = (await _issue_activation(client, admin, await _pending_id(client, admin))).json()["code"]

    for _ in range(5):
        resp = await client.post(
            "/api/v1/teachers/activate", json={"code": "ZZZZ-ZZZZ"}, headers=teacher["headers"]
        )
        assert resp.json()["detail"] == "TEACHER_CODE_INVALID"
    # Even the right code is dead now; the admin has to issue a new one.
    resp = await client.post(
        "/api/v1/teachers/activate", json={"code": code}, headers=teacher["headers"]
    )
    assert resp.status_code == 400
    status = (await client.get("/api/v1/teachers/me", headers=teacher["headers"])).json()
    assert status["activation_code_sent"] is False
    assert status["is_teacher"] is False


async def test_admin_issues_student_codes_with_a_chosen_expiry(
    client, register_user, make_admin
) -> None:
    admin = await _admin(client, register_user, make_admin, "sc1")
    student = await register_user("ogr_sc1@gmail.com", "Öğrenci")

    resp = await client.post(
        "/api/v1/admin/student-codes",
        json={"count": 3, "expires_in_days": 60},
        headers=admin["headers"],
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["max_active"] == 500
    first = body["items"][0]
    days = (datetime.fromisoformat(first["expires_at"]) - datetime.now(UTC)).days
    assert 58 <= days <= 60

    resp = await client.post(
        "/api/v1/students/verify-code", json={"code": first["code"]}, headers=student["headers"]
    )
    assert resp.status_code == 204
    wallet = (await client.get("/api/v1/credits/me", headers=student["headers"])).json()
    assert wallet["edu_verified"] is True


async def test_teacher_expiry_is_capped_at_30_days(client, register_user, make_admin) -> None:
    from tests.teachers.test_student_codes import _approved_teacher

    teacher, _ = await _approved_teacher(client, register_user, make_admin, "cap")
    resp = await client.post(
        "/api/v1/teachers/codes",
        json={"count": 1, "expires_in_days": 31},
        headers=teacher["headers"],
    )
    assert resp.status_code == 422
    resp = await client.post(
        "/api/v1/teachers/codes",
        json={"count": 1, "expires_in_days": 1},
        headers=teacher["headers"],
    )
    assert resp.status_code == 201


async def test_student_code_guessing_is_throttled(client, register_user) -> None:
    guesser = await register_user("guesser@gmail.com", "Guesser")
    for _ in range(10):
        resp = await client.post(
            "/api/v1/students/verify-code", json={"code": "AAAA-AAAA"}, headers=guesser["headers"]
        )
        assert resp.status_code == 400
    resp = await client.post(
        "/api/v1/students/verify-code", json={"code": "AAAA-AAAA"}, headers=guesser["headers"]
    )
    assert resp.status_code == 429
    assert resp.json()["detail"] == "TOO_MANY_ATTEMPTS"


async def test_email_verification_switch(client, monkeypatch) -> None:
    settings = get_settings()
    monkeypatch.setattr(settings, "env", "production")
    monkeypatch.setattr(settings, "smtp_host", "mail.example.com")

    async def no_mail(*args, **kwargs) -> bool:
        return True

    monkeypatch.setattr("app.modules.auth.service.send_mail", no_mail)

    async def register(email: str) -> dict:
        resp = await client.post(
            "/api/v1/auth/register",
            json={"email": email, "password": "securepass123", "name": "X", "kvkk_consent": True},
        )
        token = resp.json()["access_token"]
        return (
            await client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
        ).json()

    # Default (required): a code is needed.
    assert (await register("needs_code@gmail.com"))["email_verified"] is False
    # Demo switch off: verified at sign-up, no code.
    monkeypatch.setattr(settings, "email_verification_required", False)
    assert (await register("demo_signup@gmail.com"))["email_verified"] is True
