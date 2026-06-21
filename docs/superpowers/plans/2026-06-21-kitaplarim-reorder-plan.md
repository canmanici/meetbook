# Kitaplarım Drag-to-Reorder — Implementation Plan

**Goal:** Add `sort_order` column + `PATCH /books/reorder` + mobile API client.

**Architecture:** Backend schema → migration → repository cursor update → service layer → router → mobile API. Each file gets its own agent.

**Files:**
- `backend/app/modules/books/schemas.py` — add ReorderBody, ReorderDelta
- `backend/app/modules/books/models.py` — add sort_order column
- Alembic migration — new migration file + backfill
- `backend/app/modules/books/repository.py` — cursor encoding/decoding with sort_order
- `backend/app/modules/books/service.py` — reorder_books method
- `backend/app/modules/books/router.py` — PATCH /books/reorder
- `mobile/src/lib/api/client.ts` — reorderBooks function
- Test files — repository, service, router tests

---

### Task 1: `schemas.py` — Add Reorder schemas

Add after existing schemas:

```python
class ReorderDelta(BaseModel):
    book_id: UUID
    sort_order: int

class ReorderBody(BaseModel):
    reorders: list[ReorderDelta]
```

Also add `sort_order: int = 0` to `BookOwnerView` schema.

### Task 2: `models.py` — Add sort_order column

Add `sort_order: int = 0` to the `Book` model.
```python
sort_order = Column(Integer, nullable=False, default=0, server_default=text("0"))
```

### Task 3: Alembic migration

Create new migration: `ALTER TABLE books ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;`
Backfill: For each owner, assign `sort_order = ROW_NUMBER() OVER (PARTITION BY owner_id ORDER BY created_at DESC)` (exclude deleted books).

### Task 4: `repository.py` — Update cursor + ordering

Update `encode_cursor` to include `sort_order`. Update `decode_cursor` to parse it. Update `list_my_books` WHERE clause and ORDER BY.

### Task 5: `service.py` — Add reorder_books

```python
async def reorder_books(self, owner_id: UUID, reorders: list[ReorderDelta]) -> list[Book]:
    book_ids = [r.book_id for r in reorders]
    books = await self.repo.get_books_by_ids(book_ids)
    if any(b.owner_id != owner_id for b in books):
        raise PermissionError("Not all books belong to you")
    # Validate no duplicates
    if len(set(book_ids)) != len(book_ids):
        raise ValueError("Duplicate book_ids")
    async with self.session.begin():
        for delta in reorders:
            await self.session.execute(
                update(Book).where(Book.id == delta.book_id).values(sort_order=delta.sort_order)
            )
    return await self.repo.list_my_books(owner_id)
```

### Task 6: `router.py` — Add PATCH /books/reorder

```python
@router.patch("/reorder", response_model=BookListResponse)
async def reorder_books(
    body: ReorderBody,
    service: BookService = Depends(_get_service),
    current_user: User = Depends(get_current_user),
):
    items = await service.reorder_books(current_user.id, body.reorders)
    return BookListResponse(items=items, next_cursor=None)
```

### Task 7: `client.ts` — Add reorderBooks

Add to mobile API client:
```typescript
export async function reorderBooks(reorders: { book_id: string; sort_order: number }[]): Promise<BookListResponse> {
  return authedRequest<BookListResponse>('/books/reorder', 'PATCH', { reorders });
}
```

### Task 8: Tests — repository, service, router

Write tests for: cursor encoding/decoding, reorder validation, reorder execution, permission check, duplicate detection, router response.

---

## Self-Review Checklist

- [x] Spec coverage: All 5 requirements mapped to tasks
- [x] Placeholders: No TBD/TODO
- [x] Type consistency: ReorderDelta book_id matches Book.id type (UUID), sort_order is int throughout
