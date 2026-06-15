"""Pydantic schemas for the reports module."""

import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.modules.reports.models import ReportStatus, ReportTarget


class ReportCreateRequest(BaseModel):
    target_type: ReportTarget
    target_id: uuid.UUID
    reason: str = Field(min_length=1, max_length=1000)


class ReportView(BaseModel):
    id: uuid.UUID
    reporter_id: uuid.UUID
    target_type: ReportTarget
    target_id: uuid.UUID
    reason: str
    status: ReportStatus
    created_at: datetime
