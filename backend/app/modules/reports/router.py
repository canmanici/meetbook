"""Report endpoints."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_session
from app.modules.auth.dependencies import get_verified_user
from app.modules.auth.models import User
from app.modules.reports.schemas import ReportCreateRequest, ReportView
from app.modules.reports.service import ReportError, ReportService

router = APIRouter(tags=["reports"])


def _get_service(session: AsyncSession = Depends(get_session)) -> ReportService:
    return ReportService(session)


@router.post("/reports", response_model=ReportView, status_code=201)
async def create_report(
    body: ReportCreateRequest,
    user: User = Depends(get_verified_user),
    service: ReportService = Depends(_get_service),
) -> ReportView:
    try:
        return await service.create_report(user.id, body)
    except ReportError as e:
        raise HTTPException(status_code=e.status_code, detail=e.code)
