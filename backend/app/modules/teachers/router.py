"""Teacher verification: user-facing apply/status + admin review."""

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_session
from app.modules.auth.dependencies import get_admin_user, get_current_user, get_verified_user
from app.modules.auth.models import User
from app.modules.teachers.models import TeacherApplicationStatus
from app.modules.teachers.schemas import (
    AdminTeacherApplicationList,
    RedeemStudentCodeRequest,
    StudentCodeCreateRequest,
    StudentCodeListResponse,
    TeacherApplyRequest,
    TeacherRejectRequest,
    TeacherReviewRequest,
    TeacherStatusResponse,
)
from app.modules.teachers.service import TeacherError, TeacherService

router = APIRouter(prefix="/teachers", tags=["teachers"])
admin_router = APIRouter(prefix="/admin/teachers", tags=["admin"])
students_router = APIRouter(prefix="/students", tags=["teachers"])


def _service(session: AsyncSession = Depends(get_session)) -> TeacherService:
    return TeacherService(session)


def _http(e: TeacherError) -> HTTPException:
    return HTTPException(status_code=e.status_code, detail=e.code)


@router.get("/me", response_model=TeacherStatusResponse)
async def my_teacher_status(
    user: User = Depends(get_current_user),
    service: TeacherService = Depends(_service),
) -> TeacherStatusResponse:
    return await service.status(user)


@router.post("/apply", response_model=TeacherStatusResponse, status_code=201)
async def apply_as_teacher(
    body: TeacherApplyRequest,
    user: User = Depends(get_verified_user),
    service: TeacherService = Depends(_service),
) -> TeacherStatusResponse:
    try:
        return await service.apply(user, body)
    except TeacherError as e:
        raise _http(e)


@admin_router.get("", response_model=AdminTeacherApplicationList)
async def list_teacher_applications(
    status: TeacherApplicationStatus | None = Query(default=None),
    _admin: User = Depends(get_admin_user),
    service: TeacherService = Depends(_service),
) -> AdminTeacherApplicationList:
    return AdminTeacherApplicationList(items=await service.list_for_review(status))


@admin_router.post("/{application_id}/approve", status_code=204)
async def approve_teacher(
    application_id: uuid.UUID,
    body: TeacherReviewRequest,
    admin: User = Depends(get_admin_user),
    service: TeacherService = Depends(_service),
) -> None:
    try:
        await service.approve(admin, application_id, body.note)
    except TeacherError as e:
        raise _http(e)


@admin_router.post("/{application_id}/reject", status_code=204)
async def reject_teacher(
    application_id: uuid.UUID,
    body: TeacherRejectRequest,
    admin: User = Depends(get_admin_user),
    service: TeacherService = Depends(_service),
) -> None:
    try:
        await service.reject(admin, application_id, body.note)
    except TeacherError as e:
        raise _http(e)


@admin_router.post("/{application_id}/revoke", status_code=204)
async def revoke_teacher(
    application_id: uuid.UUID,
    body: TeacherRejectRequest,
    admin: User = Depends(get_admin_user),
    service: TeacherService = Depends(_service),
) -> None:
    try:
        await service.revoke(admin, application_id, body.note)
    except TeacherError as e:
        raise _http(e)


@router.get("/codes", response_model=StudentCodeListResponse)
async def my_student_codes(
    user: User = Depends(get_current_user),
    service: TeacherService = Depends(_service),
) -> StudentCodeListResponse:
    try:
        return await service.list_codes(user)
    except TeacherError as e:
        raise _http(e)


@router.post("/codes", response_model=StudentCodeListResponse, status_code=201)
async def issue_student_codes(
    body: StudentCodeCreateRequest,
    user: User = Depends(get_current_user),
    service: TeacherService = Depends(_service),
) -> StudentCodeListResponse:
    try:
        return await service.issue_codes(user, body.count)
    except TeacherError as e:
        raise _http(e)


@router.post("/codes/{code_id}/revoke", response_model=StudentCodeListResponse)
async def revoke_student_code(
    code_id: uuid.UUID,
    user: User = Depends(get_current_user),
    service: TeacherService = Depends(_service),
) -> StudentCodeListResponse:
    try:
        return await service.revoke_code(user, code_id)
    except TeacherError as e:
        raise _http(e)


@students_router.post("/verify-code", status_code=204)
async def verify_with_student_code(
    body: RedeemStudentCodeRequest,
    user: User = Depends(get_current_user),
    service: TeacherService = Depends(_service),
) -> None:
    try:
        await service.redeem_code(user, body.code)
    except TeacherError as e:
        raise _http(e)
