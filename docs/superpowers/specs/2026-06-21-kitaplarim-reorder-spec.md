# Kitaplarım Drag-to-Reorder — Design Spec

**Date:** 2026-06-21
**Status:** Direct execution (no visual companion needed — backend-only)
**Scope:** Backend: add `sort_order` column + `PATCH /books/reorder` endpoint. Mobile: add `reorderBooks` API call. UI (drag-to-reorder) deferred to SPEC 3/4 pass.
**Spec:** 2 of 4

## 1. Goal

Enable users to reorder books in their Kitaplarım page via drag-to-reorder. This spec covers the **backend infrastructure** only — the mobile drag UI will be added after SPEC 1's test suite is verified.

## 2. Changes

| File | Change |
|---|---|
| `backend/app/modules/books/models.py` | Add `sort_order: int = 0` column |
| `backend/app/modules/books/schemas.py` | Add `ReorderBody(id=UUID, order_deltas=List[ReorderDelta])`, `ReorderDelta(book_id=UUID, sort_order=int)` |
| `backend/app/modules/books/repository.py` | Update `list_my_books` cursor encoding to include `sort_order`; change `order_by` to `sort_order ASC, created_at DESC, id DESC` |
| `backend/app/modules/books/service.py` | Add `async def reorder_books(self, owner_id, reorders: List[ReorderDelta])` |
| `backend/app/modules/books/router.py` | Add `PATCH /books/reorder` endpoint |
| Alembic migration | `ALTER TABLE books ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;` + backfill script |
| `mobile/src/lib/api/client.ts` | Add `reorderBooks(reorders)` function |
| Test files | Repository, service, router tests |

## 3. Cursor Adaptation

Current cursor encodes `created_at + id`. Updated cursor encodes `sort_order + created_at + id`:

```python
def encode_cursor(sort_order: int, created_at: datetime, book_id: uuid.UUID) -> str:
    raw = f"{sort_order:010d}:{created_at.isoformat()}:{str(book_id)}"
    return base64.urlsafe_b64encode(raw.encode()).decode()
```

The `list_my_books` query uses:
```sql
WHERE (sort_order > :cursor_sort_order)
   OR (sort_order = :cursor_sort_order AND created_at < :cursor_created_at)
   OR (sort_order = :cursor_sort_order AND created_at = :cursor_created_at AND id < :cursor_id)
ORDER BY sort_order ASC, created_at DESC, id DESC
```

## 4. Reorder endpoint

```
PATCH /books/reorder
Body: { reorders: [{ book_id: UUID, sort_order: int }] }
Response: { items: BookOwnerView[] }
Auth: Required (owner only)
```

- Validates all `book_id`s belong to the requesting user
- Batch updates in a single transaction
- Invalidates `list_my_books` cursor (client must refetch)

## 5. Mobile API addition

```typescript
export async function reorderBooks(reorders: { book_id: string; sort_order: number }[]): Promise<BookListResponse> {
  return authedRequest<BookListResponse>('/books/reorder', 'PATCH', { reorders });
}
```

Drag-to-reorder UI (grip handle, Reanimated drag gesture, call on drop) is **not in this spec** — it will be implemented after SPEC 1 ships and SPEC 2 backend is deployed.
