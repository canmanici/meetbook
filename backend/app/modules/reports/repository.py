"""Database queries for the reports module."""

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.reports.models import Report, ReportStatus


class ReportRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def create(
        self,
        reporter_id: uuid.UUID,
        target_type: str,
        target_id: uuid.UUID,
        reason: str,
        content_snapshot: dict,
    ) -> Report:
        report = Report(
            reporter_id=reporter_id,
            target_type=target_type,
            target_id=target_id,
            reason=reason,
            content_snapshot=content_snapshot,
        )
        self.session.add(report)
        await self.session.flush()
        return report

    async def get(self, report_id: uuid.UUID) -> Report | None:
        result = await self.session.execute(select(Report).where(Report.id == report_id))
        return result.scalar_one_or_none()

    async def list_queue(self, status: ReportStatus | None) -> list[Report]:
        stmt = select(Report)
        if status is not None:
            stmt = stmt.where(Report.status == status)
        stmt = stmt.order_by(Report.created_at.asc())
        result = await self.session.execute(stmt)
        return list(result.scalars().all())
