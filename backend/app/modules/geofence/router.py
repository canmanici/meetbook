"""Geofence alert endpoints."""

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_session
from app.modules.auth.dependencies import get_current_user
from app.modules.auth.models import User
from app.modules.geofence.schemas import GeofenceAlertListResponse, GeofenceAlertView
from app.modules.geofence.service import GeofenceService

router = APIRouter(tags=["geofence"])


def _get_service(session: AsyncSession = Depends(get_session)) -> GeofenceService:
    return GeofenceService(session)


@router.get("/geofence/alerts", response_model=GeofenceAlertListResponse)
async def list_alerts(
    user: User = Depends(get_current_user),
    service: GeofenceService = Depends(_get_service),
) -> GeofenceAlertListResponse:
    return await service.get_alerts(user.id)


@router.patch("/geofence/alerts/{alert_id}/read", response_model=GeofenceAlertView)
async def mark_alert_read(
    alert_id: uuid.UUID,
    user: User = Depends(get_current_user),
    service: GeofenceService = Depends(_get_service),
) -> GeofenceAlertView:
    result = await service.mark_read(user.id, alert_id)
    if not result:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Alert not found")
    return result
