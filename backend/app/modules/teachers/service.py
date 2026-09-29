"""Teacher applications: apply → a human admin approves / rejects / revokes."""

import logging
import secrets
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_event
from app.modules.auth.models import User
from app.modules.books.models import Book
from app.modules.reports.models import Report, ReportTarget
from app.modules.teachers.models import StudentCode, TeacherApplication, TeacherApplicationStatus
from app.modules.teachers.schemas import (
    AdminTeacherApplicationView,
    StudentCodeListResponse,
    StudentCodeView,
    TeacherApplicationView,
    TeacherApplyRequest,
    TeacherStatusResponse,
)

logger = logging.getLogger(__name__)

# After a rejection, wait before trying again (stops "apply until someone says yes").
REAPPLY_COOLDOWN = timedelta(days=30)

# Student codes: a teacher can't mint accounts wholesale.
MAX_ACTIVE_CODES = 30
CODE_TTL = timedelta(days=14)
# No 0/O, 1/I/L: codes are read aloud and copied off a board.
_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
_CODE_LEN = 8


def _new_code() -> str:
    return "".join(secrets.choice(_CODE_ALPHABET) for _ in range(_CODE_LEN))


def normalize_student_code(raw: str) -> str:
    return "".join(ch for ch in raw.upper() if ch.isalnum())


def _format_code(code: str) -> str:
    return f"{code[:4]}-{code[4:]}"


def _code_status(c: StudentCode, now: datetime) -> str:
    if c.redeemed_at is not None:
        return "redeemed"
    if c.revoked_at is not None:
        return "revoked"
    if c.expires_at <= now:
        return "expired"
    return "active"


class TeacherError(Exception):
    def __init__(self, code: str, status_code: int = 400) -> None:
        self.code = code
        self.status_code = status_code


def _view(app: TeacherApplication) -> TeacherApplicationView:
    return TeacherApplicationView(
        id=app.id,
        institution=app.institution,
        department=app.department,
        work_email=app.work_email,
        profile_url=app.profile_url,
        note=app.note,
        status=app.status,
        review_note=app.review_note,
        reviewed_at=app.reviewed_at,
        created_at=app.created_at,
    )


class TeacherService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def _latest(self, user_id: uuid.UUID) -> TeacherApplication | None:
        result = await self.session.execute(
            select(TeacherApplication)
            .where(TeacherApplication.user_id == user_id)
            .order_by(TeacherApplication.created_at.desc())
            .limit(1)
        )
        return result.scalar_one_or_none()

    def _apply_block(self, latest: TeacherApplication | None) -> tuple[str | None, datetime | None]:
        """(error code, reapply_after) — why this user can't apply right now."""
        if latest is None:
            return None, None
        if latest.status in (TeacherApplicationStatus.pending, TeacherApplicationStatus.approved):
            return "TEACHER_APPLICATION_OPEN", None
        if latest.status is TeacherApplicationStatus.revoked:
            # Lost the badge once: only an admin can give it back.
            return "TEACHER_REVOKED", None
        reviewed = latest.reviewed_at or latest.created_at
        if datetime.now(UTC) - reviewed < REAPPLY_COOLDOWN:
            return "TEACHER_REAPPLY_TOO_SOON", reviewed + REAPPLY_COOLDOWN
        return None, None

    async def status(self, user: User) -> TeacherStatusResponse:
        latest = await self._latest(user.id)
        block, reapply_after = self._apply_block(latest)
        return TeacherStatusResponse(
            is_teacher=user.teacher_verified_at is not None,
            institution=user.teacher_institution,
            application=_view(latest) if latest else None,
            can_apply=block is None,
            reapply_after=reapply_after,
        )

    async def apply(self, user: User, body: TeacherApplyRequest) -> TeacherStatusResponse:
        block, _ = self._apply_block(await self._latest(user.id))
        if block == "TEACHER_REAPPLY_TOO_SOON":
            raise TeacherError(block, 429)
        if block is not None:
            raise TeacherError(block, 409)
        self.session.add(
            TeacherApplication(
                user_id=user.id,
                institution=" ".join(body.institution.split()),
                department=" ".join(body.department.split()) if body.department else None,
                work_email=str(body.work_email).lower() if body.work_email else None,
                profile_url=body.profile_url,
                note=body.note,
            )
        )
        try:
            await log_event(self.session, "teacher_applied", user_id=user.id)
            await self.session.commit()
        except IntegrityError as e:  # a parallel apply won the unique index
            await self.session.rollback()
            raise TeacherError("TEACHER_APPLICATION_OPEN", 409) from e
        return await self.status(user)

    # -- Admin -------------------------------------------------------------

    async def list_for_review(
        self, status: TeacherApplicationStatus | None, limit: int = 100
    ) -> list[AdminTeacherApplicationView]:
        stmt = select(TeacherApplication, User).join(User, User.id == TeacherApplication.user_id)
        if status is not None:
            stmt = stmt.where(TeacherApplication.status == status)
        rows = (
            await self.session.execute(
                stmt.order_by(TeacherApplication.created_at.desc()).limit(limit)
            )
        ).all()
        user_ids = [u.id for _, u in rows]
        reviewer_ids = {a.reviewed_by for a, _ in rows if a.reviewed_by}

        book_counts = dict(
            (
                await self.session.execute(
                    select(Book.owner_id, func.count())
                    .where(Book.owner_id.in_(user_ids), Book.deleted_at.is_(None))
                    .group_by(Book.owner_id)
                )
            ).all()
        )
        report_counts = dict(
            (
                await self.session.execute(
                    select(Report.target_id, func.count())
                    .where(
                        Report.target_type == ReportTarget.user,
                        Report.target_id.in_(user_ids),
                    )
                    .group_by(Report.target_id)
                )
            ).all()
        )
        code_stats = {
            teacher_id: (issued, redeemed)
            for teacher_id, issued, redeemed in (
                await self.session.execute(
                    select(
                        StudentCode.teacher_id,
                        func.count(),
                        func.count(StudentCode.redeemed_at),
                    )
                    .where(StudentCode.teacher_id.in_(user_ids))
                    .group_by(StudentCode.teacher_id)
                )
            ).all()
        }
        reviewers = dict(
            (
                await self.session.execute(
                    select(User.id, User.name).where(User.id.in_(reviewer_ids))
                )
            ).all()
        )
        return [
            AdminTeacherApplicationView(
                **_view(app).model_dump(),
                user_id=user.id,
                user_name=user.name,
                user_email=user.email,
                user_created_at=user.created_at,
                edu_email=user.edu_email,
                completed_exchanges=user.completed_exchanges,
                active_book_count=book_counts.get(user.id, 0),
                reports_against=report_counts.get(user.id, 0),
                reviewed_by_name=reviewers.get(app.reviewed_by),
                codes_issued=code_stats.get(user.id, (0, 0))[0],
                codes_redeemed=code_stats.get(user.id, (0, 0))[1],
            )
            for app, user in rows
        ]

    async def _get_for_update(self, application_id: uuid.UUID) -> TeacherApplication:
        app = (
            await self.session.execute(
                select(TeacherApplication)
                .where(TeacherApplication.id == application_id)
                .with_for_update()
            )
        ).scalar_one_or_none()
        if app is None:
            raise TeacherError("NOT_FOUND", 404)
        return app

    async def _decide(
        self,
        admin: User,
        application_id: uuid.UUID,
        expected: TeacherApplicationStatus,
        new_status: TeacherApplicationStatus,
        note: str | None,
    ) -> TeacherApplication:
        app = await self._get_for_update(application_id)
        if app.status is not expected:
            raise TeacherError("INVALID_STATUS", 409)
        if app.user_id == admin.id:
            # Nobody approves (or clears) their own badge.
            raise TeacherError("SELF_REVIEW", 403)
        app.status = new_status
        app.review_note = note
        app.reviewed_by = admin.id
        app.reviewed_at = datetime.now(UTC)

        user = await self.session.get(User, app.user_id, with_for_update=True)
        assert user is not None
        if new_status is TeacherApplicationStatus.approved:
            user.teacher_verified_at = app.reviewed_at
            user.teacher_institution = app.institution
        else:
            user.teacher_verified_at = None
            user.teacher_institution = None
            # A teacher who loses the badge can't keep verifying students.
            await self._revoke_open_codes(user.id)

        await log_event(
            self.session,
            f"teacher_{new_status.value}",
            user_id=admin.id,
            metadata={
                "application_id": str(app.id),
                "teacher_user_id": str(app.user_id),
                "note": note,
            },
        )
        await self.session.commit()
        await self._notify(app)
        return app

    async def _notify(self, app: TeacherApplication) -> None:
        from app.modules.notifications.service import NotificationService

        title, body = {
            TeacherApplicationStatus.approved: (
                "Öğretmen hesabın onaylandı",
                "Profilinde artık öğretmen rozeti görünüyor.",
            ),
            TeacherApplicationStatus.rejected: (
                "Öğretmen başvurun reddedildi",
                app.review_note or "Ayrıntılar için başvuru ekranına bak.",
            ),
            TeacherApplicationStatus.revoked: (
                "Öğretmen rozetin kaldırıldı",
                app.review_note or "Ayrıntılar için başvuru ekranına bak.",
            ),
        }[app.status]
        try:
            await NotificationService(self.session).notify(
                app.user_id,
                "teacher_application",
                {"application_id": str(app.id), "status": app.status.value},
                title=title,
                body=body,
            )
            await self.session.commit()
        except Exception:
            logger.exception("Teacher decision notification failed for %s", app.id)

    async def approve(self, admin: User, application_id: uuid.UUID, note: str | None) -> None:
        await self._decide(
            admin,
            application_id,
            TeacherApplicationStatus.pending,
            TeacherApplicationStatus.approved,
            note,
        )

    async def reject(self, admin: User, application_id: uuid.UUID, note: str) -> None:
        await self._decide(
            admin,
            application_id,
            TeacherApplicationStatus.pending,
            TeacherApplicationStatus.rejected,
            note,
        )

    async def revoke(self, admin: User, application_id: uuid.UUID, note: str) -> None:
        await self._decide(
            admin,
            application_id,
            TeacherApplicationStatus.approved,
            TeacherApplicationStatus.revoked,
            note,
        )

    # -- Student codes (teacher → student verification) ---------------------

    async def _active_code_count(self, teacher_id: uuid.UUID) -> int:
        return (
            await self.session.scalar(
                select(func.count()).where(
                    StudentCode.teacher_id == teacher_id,
                    StudentCode.redeemed_at.is_(None),
                    StudentCode.revoked_at.is_(None),
                    StudentCode.expires_at > datetime.now(UTC),
                )
            )
        ) or 0

    async def _revoke_open_codes(self, teacher_id: uuid.UUID) -> None:
        codes = (
            await self.session.execute(
                select(StudentCode).where(
                    StudentCode.teacher_id == teacher_id,
                    StudentCode.redeemed_at.is_(None),
                    StudentCode.revoked_at.is_(None),
                )
            )
        ).scalars()
        now = datetime.now(UTC)
        for code in codes:
            code.revoked_at = now

    async def list_codes(self, teacher: User) -> StudentCodeListResponse:
        if teacher.teacher_verified_at is None:
            raise TeacherError("NOT_TEACHER", 403)
        rows = (
            await self.session.execute(
                select(StudentCode)
                .where(StudentCode.teacher_id == teacher.id)
                .order_by(StudentCode.created_at.desc())
                .limit(100)
            )
        ).scalars()
        now = datetime.now(UTC)
        items = [
            StudentCodeView(
                id=c.id,
                code=_format_code(c.code),
                created_at=c.created_at,
                expires_at=c.expires_at,
                status=_code_status(c, now),
                redeemed_at=c.redeemed_at,
            )
            for c in rows
        ]
        return StudentCodeListResponse(
            items=items,
            active_count=sum(1 for i in items if i.status == "active"),
            max_active=MAX_ACTIVE_CODES,
        )

    async def issue_codes(self, teacher: User, count: int) -> StudentCodeListResponse:
        if teacher.teacher_verified_at is None:
            raise TeacherError("NOT_TEACHER", 403)
        # Serialize issuing per teacher so two requests can't both pass the cap.
        await self.session.get(User, teacher.id, with_for_update=True)
        if await self._active_code_count(teacher.id) + count > MAX_ACTIVE_CODES:
            raise TeacherError("CODE_LIMIT", 409)
        expires_at = datetime.now(UTC) + CODE_TTL
        for _ in range(count):
            self.session.add(
                StudentCode(code=_new_code(), teacher_id=teacher.id, expires_at=expires_at)
            )
        await log_event(
            self.session, "student_codes_issued", user_id=teacher.id, metadata={"count": count}
        )
        await self.session.commit()
        return await self.list_codes(teacher)

    async def revoke_code(self, teacher: User, code_id: uuid.UUID) -> StudentCodeListResponse:
        code = await self.session.get(StudentCode, code_id, with_for_update=True)
        if code is None or code.teacher_id != teacher.id:
            raise TeacherError("NOT_FOUND", 404)
        if code.redeemed_at is None and code.revoked_at is None:
            code.revoked_at = datetime.now(UTC)
            await self.session.commit()
        return await self.list_codes(teacher)

    async def redeem_code(self, student: User, raw_code: str) -> None:
        """Verify a student with a teacher's class code. Every failure looks
        the same (INVALID_STUDENT_CODE) so codes can't be probed."""
        from app.modules.credits.service import CreditService

        if student.edu_verified_at is not None:
            raise TeacherError("ALREADY_STUDENT", 409)
        code = (
            await self.session.execute(
                select(StudentCode)
                .where(StudentCode.code == normalize_student_code(raw_code))
                .with_for_update()
            )
        ).scalar_one_or_none()
        now = datetime.now(UTC)
        teacher = await self.session.get(User, code.teacher_id) if code else None
        if (
            code is None
            or _code_status(code, now) != "active"
            or code.teacher_id == student.id
            or teacher is None
            or teacher.teacher_verified_at is None
        ):
            raise TeacherError("INVALID_STUDENT_CODE", 400)

        code.redeemed_by = student.id
        code.redeemed_at = now
        user = await self.session.get(User, student.id, with_for_update=True)
        assert user is not None
        user.edu_verified_at = now
        user.verified_by_teacher_id = code.teacher_id
        await CreditService(self.session).grant_starter(user.id)
        await log_event(
            self.session,
            "student_verified_by_code",
            user_id=user.id,
            metadata={"teacher_user_id": str(code.teacher_id), "code_id": str(code.id)},
        )
        await self.session.commit()
