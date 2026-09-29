import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr, Field

from app.modules.teachers.models import TeacherApplicationStatus


class TeacherApplyRequest(BaseModel):
    institution: str = Field(min_length=2, max_length=200)
    department: str | None = Field(default=None, max_length=200)
    work_email: EmailStr | None = None
    profile_url: str | None = Field(default=None, max_length=500, pattern=r"^https?://")
    note: str | None = Field(default=None, max_length=1000)


class TeacherApplicationView(BaseModel):
    id: uuid.UUID
    institution: str
    department: str | None
    work_email: str | None
    profile_url: str | None
    note: str | None
    status: TeacherApplicationStatus
    review_note: str | None
    reviewed_at: datetime | None
    created_at: datetime


class TeacherStatusResponse(BaseModel):
    is_teacher: bool
    institution: str | None
    application: TeacherApplicationView | None
    can_apply: bool
    reapply_after: datetime | None = None


class AdminTeacherApplicationView(TeacherApplicationView):
    """What the reviewer sees: the claim plus enough history to smell trouble."""

    user_id: uuid.UUID
    user_name: str
    user_email: str
    user_created_at: datetime
    edu_email: str | None
    completed_exchanges: int
    active_book_count: int
    reports_against: int
    reviewed_by_name: str | None = None
    codes_issued: int = 0
    codes_redeemed: int = 0


class AdminTeacherApplicationList(BaseModel):
    items: list[AdminTeacherApplicationView]


class TeacherReviewRequest(BaseModel):
    note: str | None = Field(default=None, max_length=1000)


class TeacherRejectRequest(BaseModel):
    # A rejection or revocation must say why — it's shown to the applicant
    # and kept for the next reviewer.
    note: str = Field(min_length=3, max_length=1000)


class StudentCodeCreateRequest(BaseModel):
    count: int = Field(default=1, ge=1, le=10)


class StudentCodeView(BaseModel):
    id: uuid.UUID
    code: str  # formatted XXXX-XXXX
    created_at: datetime
    expires_at: datetime
    status: str  # active | redeemed | expired | revoked
    redeemed_at: datetime | None = None


class StudentCodeListResponse(BaseModel):
    items: list[StudentCodeView]
    active_count: int
    max_active: int


class RedeemStudentCodeRequest(BaseModel):
    code: str = Field(min_length=8, max_length=20)
