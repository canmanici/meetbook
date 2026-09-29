"""Teacher applications: apply, human review, audit trail, and the limits."""

import uuid
from datetime import UTC, datetime, timedelta

import httpx
import pytest
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.auth.models import AuditLog
from app.modules.teachers.models import TeacherApplication

pytestmark = pytest.mark.asyncio

APPLICATION = {
    "institution": "İstanbul Teknik Üniversitesi",
    "department": "Matematik",
    "work_email": "hoca@gmail.com",
    "profile_url": "https://www.itu.edu.tr/kadro/hoca",
    "note": "MAT101 dersini veriyorum",
}


async def _apply(client: httpx.AsyncClient, user: dict) -> httpx.Response:
    return await client.post("/api/v1/teachers/apply", json=APPLICATION, headers=user["headers"])


async def _pending_id(client: httpx.AsyncClient, admin: dict) -> str:
    resp = await client.get(
        "/api/v1/admin/teachers", params={"status": "pending"}, headers=admin["headers"]
    )
    assert resp.status_code == 200
    return resp.json()["items"][0]["id"]


async def test_apply_with_a_non_edu_email_then_admin_approves(
    client, register_user, make_admin, db_session: AsyncSession
) -> None:
    teacher = await register_user("hoca@gmail.com", "Hoca")
    admin = await register_user("admin_t@example.com", "Admin")
    await make_admin(admin["user_id"])

    resp = await _apply(client, teacher)
    assert resp.status_code == 201, resp.text
    assert resp.json()["application"]["status"] == "pending"
    assert resp.json()["is_teacher"] is False

    # The reviewer sees the claim plus the applicant's history.
    listing = (await client.get("/api/v1/admin/teachers", headers=admin["headers"])).json()[
        "items"
    ][0]
    assert listing["user_email"] == "hoca@gmail.com"
    assert listing["profile_url"] == APPLICATION["profile_url"]
    assert listing["reports_against"] == 0

    resp = await client.post(
        f"/api/v1/admin/teachers/{listing['id']}/approve",
        json={"note": "Kadro sayfası kontrol edildi"},
        headers=admin["headers"],
    )
    assert resp.status_code == 204

    status = (await client.get("/api/v1/teachers/me", headers=teacher["headers"])).json()
    assert status["is_teacher"] is True
    assert status["institution"] == "İstanbul Teknik Üniversitesi"
    me = (await client.get("/api/v1/auth/me", headers=teacher["headers"])).json()
    assert me["is_teacher"] is True

    # Who approved whom is on the record.
    logs = (
        (
            await db_session.execute(
                select(AuditLog).where(AuditLog.event_type == "teacher_approved")
            )
        )
        .scalars()
        .all()
    )
    assert len(logs) == 1
    assert str(logs[0].user_id) == admin["user_id"]


async def test_non_admin_cannot_review(client, register_user) -> None:
    teacher = await register_user("t2@gmail.com", "Hoca")
    other = await register_user("o2@gmail.com", "Other")
    await _apply(client, teacher)
    resp = await client.get("/api/v1/admin/teachers", headers=other["headers"])
    assert resp.status_code == 403


async def test_admin_cannot_approve_their_own_application(
    client, register_user, make_admin
) -> None:
    admin = await register_user("self@gmail.com", "Admin")
    await make_admin(admin["user_id"])
    await _apply(client, admin)
    app_id = await _pending_id(client, admin)
    resp = await client.post(
        f"/api/v1/admin/teachers/{app_id}/approve", json={}, headers=admin["headers"]
    )
    assert resp.status_code == 403
    assert resp.json()["detail"] == "SELF_REVIEW"


async def test_one_open_application_and_a_cooldown_after_rejection(
    client, register_user, make_admin, db_session: AsyncSession
) -> None:
    teacher = await register_user("t3@gmail.com", "Hoca")
    admin = await register_user("a3@example.com", "Admin")
    await make_admin(admin["user_id"])

    assert (await _apply(client, teacher)).status_code == 201
    dup = await _apply(client, teacher)
    assert dup.status_code == 409
    assert dup.json()["detail"] == "TEACHER_APPLICATION_OPEN"

    app_id = await _pending_id(client, admin)
    # Rejecting needs a reason.
    assert (
        await client.post(
            f"/api/v1/admin/teachers/{app_id}/reject", json={}, headers=admin["headers"]
        )
    ).status_code == 422
    resp = await client.post(
        f"/api/v1/admin/teachers/{app_id}/reject",
        json={"note": "Kadroda bulunamadı"},
        headers=admin["headers"],
    )
    assert resp.status_code == 204

    status = (await client.get("/api/v1/teachers/me", headers=teacher["headers"])).json()
    assert status["can_apply"] is False
    assert status["application"]["review_note"] == "Kadroda bulunamadı"
    again = await _apply(client, teacher)
    assert again.status_code == 429
    assert again.json()["detail"] == "TEACHER_REAPPLY_TOO_SOON"

    # 31 days later they may try again.
    await db_session.execute(
        update(TeacherApplication)
        .where(TeacherApplication.id == uuid.UUID(app_id))
        .values(reviewed_at=datetime.now(UTC) - timedelta(days=31))
    )
    await db_session.commit()
    assert (await _apply(client, teacher)).status_code == 201


async def test_revoked_teacher_loses_the_badge_and_cannot_reapply(
    client, register_user, make_admin
) -> None:
    teacher = await register_user("t4@gmail.com", "Hoca")
    admin = await register_user("a4@example.com", "Admin")
    await make_admin(admin["user_id"])
    await _apply(client, teacher)
    app_id = await _pending_id(client, admin)
    await client.post(f"/api/v1/admin/teachers/{app_id}/approve", json={}, headers=admin["headers"])

    resp = await client.post(
        f"/api/v1/admin/teachers/{app_id}/revoke",
        json={"note": "Öğrencilere kitabını parayla sattı"},
        headers=admin["headers"],
    )
    assert resp.status_code == 204
    status = (await client.get("/api/v1/teachers/me", headers=teacher["headers"])).json()
    assert status["is_teacher"] is False
    assert status["application"]["status"] == "revoked"
    resp = await _apply(client, teacher)
    assert resp.status_code == 409
    assert resp.json()["detail"] == "TEACHER_REVOKED"


async def test_teacher_gets_no_credits(client, register_user, make_admin) -> None:
    teacher = await register_user("t5@gmail.com", "Hoca")
    admin = await register_user("a5@example.com", "Admin")
    await make_admin(admin["user_id"])
    await _apply(client, teacher)
    await client.post(
        f"/api/v1/admin/teachers/{await _pending_id(client, admin)}/approve",
        json={},
        headers=admin["headers"],
    )
    wallet = (await client.get("/api/v1/credits/me", headers=teacher["headers"])).json()
    assert wallet["balance"] == 0
    assert wallet["floor"] == 0
