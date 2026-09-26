"""Database queries for saved searches."""

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.saved_searches.models import SavedSearch


class SavedSearchRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def create(
        self, user_id: uuid.UUID, name: str | None, params: dict[str, Any]
    ) -> SavedSearch:
        entry = SavedSearch(user_id=user_id, name=name, params=params)
        self.session.add(entry)
        await self.session.flush()
        return entry

    async def list_by_user(self, user_id: uuid.UUID) -> list[SavedSearch]:
        result = await self.session.execute(
            select(SavedSearch)
            .where(SavedSearch.user_id == user_id)
            .order_by(SavedSearch.created_at.desc())
        )
        return list(result.scalars().all())

    async def get_by_id(self, search_id: uuid.UUID) -> SavedSearch | None:
        result = await self.session.execute(select(SavedSearch).where(SavedSearch.id == search_id))
        return result.scalar_one_or_none()

    async def update(
        self, search_id: uuid.UUID, name: str | None = None, params: dict[str, Any] | None = None
    ) -> SavedSearch | None:
        values: dict[str, Any] = {"updated_at": datetime.now(UTC)}
        if name is not None:
            values["name"] = name
        if params is not None:
            values["params"] = params
        await self.session.execute(
            update(SavedSearch).where(SavedSearch.id == search_id).values(**values)
        )
        return await self.get_by_id(search_id)

    async def delete(self, search_id: uuid.UUID) -> None:
        await self.session.execute(delete(SavedSearch).where(SavedSearch.id == search_id))
