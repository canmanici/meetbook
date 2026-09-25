"""Saved searches business logic."""
import uuid
from sqlalchemy.ext.asyncio import AsyncSession
from app.modules.saved_searches.repository import SavedSearchRepository
from app.modules.saved_searches.schemas import (
    SavedSearchCreate,
    SavedSearchUpdate,
    SavedSearchView,
    SavedSearchListResponse,
)


class SavedSearchError(Exception):
    def __init__(self, message: str, status_code: int = 400) -> None:
        self.message = message
        self.status_code = status_code


class SavedSearchService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.repo = SavedSearchRepository(session)

    async def create(self, user_id: uuid.UUID, body: SavedSearchCreate) -> SavedSearchView:
        entry = await self.repo.create(user_id, body.name, body.params)
        await self.session.commit()
        return SavedSearchView(
            id=entry.id,
            user_id=entry.user_id,
            name=entry.name,
            params=entry.params,
            created_at=entry.created_at,
            updated_at=entry.updated_at,
        )

    async def list_by_user(self, user_id: uuid.UUID) -> SavedSearchListResponse:
        items = await self.repo.list_by_user(user_id)
        return SavedSearchListResponse(
            items=[
                SavedSearchView(
                    id=item.id,
                    user_id=item.user_id,
                    name=item.name,
                    params=item.params,
                    created_at=item.created_at,
                    updated_at=item.updated_at,
                )
                for item in items
            ]
        )

    async def get_by_id(self, search_id: uuid.UUID, user_id: uuid.UUID) -> SavedSearchView:
        entry = await self.repo.get_by_id(search_id)
        if entry is None or entry.user_id != user_id:
            raise SavedSearchError("Not found", 404)
        return SavedSearchView(
            id=entry.id,
            user_id=entry.user_id,
            name=entry.name,
            params=entry.params,
            created_at=entry.created_at,
            updated_at=entry.updated_at,
        )

    async def update(self, search_id: uuid.UUID, user_id: uuid.UUID, body: SavedSearchUpdate) -> SavedSearchView:
        entry = await self.repo.get_by_id(search_id)
        if entry is None or entry.user_id != user_id:
            raise SavedSearchError("Not found", 404)
        updated = await self.repo.update(
            search_id,
            name=body.name,
            params=body.params,
        )
        await self.session.commit()
        if updated is None:  # deleted concurrently
            raise SavedSearchError("Not found", 404)
        return SavedSearchView(
            id=updated.id,
            user_id=updated.user_id,
            name=updated.name,
            params=updated.params,
            created_at=updated.created_at,
            updated_at=updated.updated_at,
        )

    async def delete(self, search_id: uuid.UUID, user_id: uuid.UUID) -> None:
        entry = await self.repo.get_by_id(search_id)
        if entry is None or entry.user_id != user_id:
            raise SavedSearchError("Not found", 404)
        await self.repo.delete(search_id)
        await self.session.commit()
