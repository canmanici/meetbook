"""Admin: KVKK data-subject request queue (30-day legal deadline tracking)."""

import uuid
from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_event
from app.core.db import get_session
from app.modules.auth.dependencies import get_admin_user
from app.modules.auth.models import User
from app.modules.legal.models import DataSubjectRequestRecord

router = APIRouter(prefix="/admin", tags=["admin-ext"])

Status = Literal["open", "in_progress", "answered", "rejected"]


class KvkkRequestView(BaseModel):
    id: uuid.UUID
    reference: str
    full_name: str
    email: str
    phone: str | None
    username: str
    request_type: str
    description: str
    extra_info: str | None
    identity_method: str
    status: str
    admin_notes: str | None
    created_at: datetime
    due_at: datetime
    closed_at: datetime | None
    overdue: bool


class KvkkRequestList(BaseModel):
    items: list[KvkkRequestView]
    total: int
    open_count: int
    overdue_count: int


class KvkkUpdate(BaseModel):
    status: Status
    admin_notes: str | None = Field(default=None, max_length=5000)


def _view(r: DataSubjectRequestRecord) -> KvkkRequestView:
    now = datetime.now(UTC)
    return KvkkRequestView(
        id=r.id,
        reference=r.reference,
        full_name=r.full_name,
        email=r.email,
        phone=r.phone,
        username=r.username,
        request_type=r.request_type,
        description=r.description,
        extra_info=r.extra_info,
        identity_method=r.identity_method,
        status=r.status,
        admin_notes=r.admin_notes,
        created_at=r.created_at,
        due_at=r.due_at,
        closed_at=r.closed_at,
        overdue=r.closed_at is None and r.due_at < now,
    )


@router.get("/kvkk-requests", response_model=KvkkRequestList)
async def list_kvkk_requests(
    status: Status | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    _: User = Depends(get_admin_user),
    session: AsyncSession = Depends(get_session),
) -> KvkkRequestList:
    stmt = select(DataSubjectRequestRecord)
    if status:
        stmt = stmt.where(DataSubjectRequestRecord.status == status)
    total = await session.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = await session.execute(
        stmt.order_by(DataSubjectRequestRecord.due_at.asc()).offset(offset).limit(limit)
    )
    open_q = DataSubjectRequestRecord.closed_at.is_(None)
    open_count = await session.scalar(select(func.count()).where(open_q)) or 0
    overdue = (
        await session.scalar(
            select(func.count()).where(open_q, DataSubjectRequestRecord.due_at < datetime.now(UTC))
        )
        or 0
    )
    return KvkkRequestList(
        items=[_view(r) for r in rows.scalars().all()],
        total=total,
        open_count=open_count,
        overdue_count=overdue,
    )


@router.post("/kvkk-requests/{request_id}", response_model=KvkkRequestView)
async def update_kvkk_request(
    request_id: uuid.UUID,
    body: KvkkUpdate,
    admin: User = Depends(get_admin_user),
    session: AsyncSession = Depends(get_session),
) -> KvkkRequestView:
    r = await session.get(DataSubjectRequestRecord, request_id)
    if r is None:
        raise HTTPException(status_code=404, detail="NOT_FOUND")
    r.status = body.status
    if body.admin_notes is not None:
        r.admin_notes = body.admin_notes
    r.handled_by = admin.id
    r.closed_at = datetime.now(UTC) if body.status in ("answered", "rejected") else None
    await log_event(
        session,
        "kvkk_request_updated",
        user_id=admin.id,
        metadata={"reference": r.reference, "status": body.status},
    )
    await session.commit()
    return _view(r)
