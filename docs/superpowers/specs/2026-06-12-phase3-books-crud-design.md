# Phase 3, Sub-project 1 — Books CRUD Core: Design Spec

> **Status:** Approved
> **Date:** 2026-06-12
> **Approach:** Vertical Slices (build each feature end-to-end, same pattern as Phase 1)
> **Scope:** Books data model + CRUD API + mobile create/list/edit/delete screens.
> Explicitly **out of scope** (later Phase 3 sub-projects): photo upload (#2), ISBN scan (#3),
> nearby search/discovery/filters (#4), wishlist/favorites (#5).

---

## 1. Data Model

### `books` table (new Alembic migration)

| Column | Type | Notes |
|---|---|---|
| `id` | UUID (PK) | Default `gen_random_uuid()` |
| `owner_id` | UUID (FK→users) | Not null |
| `title` | text | Not null |
| `author` | text | Nullable |
| `isbn` | text | Nullable (scan/lookup comes in sub-project #3) |
| `description` | text | Nullable |
| `category` | ENUM `book_category` | `fiction, non_fiction, textbook, children, comics, poetry, other` |
| `language` | text | Not null, default `'tr'` |
| `condition` | ENUM `book_condition` | `new, like_new, good, worn` (per `DATABASE_SCHEMA.md`) |
| `is_available` | boolean | Not null, default `true` |
| `location` | geography(Point, 4326) | True point. **Never returned to non-owners.** |
| `public_location` | geography(Point, 4326) | Static blur snap (see §3) |
| `deleted_at` | timestamptz | Nullable — soft delete |
| `created_at` / `updated_at` | timestamptz | Standard |

Indexes: `owner_id`, GiST on `public_location` and `location` (reused later by sub-project #4's
search; cheap to add now).

**Deferred to later sub-projects:** `book_photos` table (#2), `wishlist_items`/`favorites` (#5),
new-account listing limits (Phase 7 trust features), `book_photos`-driven "listing complete"
gating.

---

## 2. API Endpoints (`/api/v1/books`)

Module follows the standard layering: `router.py` → `service.py` → `repository.py`,
`schemas.py`, `models.py`. `service.py` does authorization first, per
`TECHNICAL_ARCHITECTURE.md`.

### `POST /books` (requires `get_verified_user`)

- **Body:** `title`, `author?`, `isbn?`, `description?`, `category`, `language`, `condition`,
  `location: {lat, lng}`
- **Returns:** full book object (owner view — includes true `location`)
- **Logic:**
  1. Validate `location` is within the Turkey bounding box (35.8–42.1N, 25.7–44.8E) →
     `400 LOCATION_OUTSIDE_TURKEY` if not (full polygon geofence deferred to Phase 5, which
     needs `country_boundaries` for meetup points anyway)
  2. Compute `public_location` via the static blur snap (§3)
  3. Insert row with `owner_id = current_user.id`

### `GET /books/me` (requires `get_current_user`)

- **Query:** `cursor?`, `limit?` (≤ 50, default per `BACKEND_API_PLAN.md` conventions)
- **Returns:** paginated list of the caller's own books, **all statuses** (including
  unavailable / soft-deleted excluded — soft-deleted never returned even to owner via list),
  true `location` included
- **Logic:** `repository.list_by_owner(owner_id, cursor, limit)` — filters `deleted_at IS NULL`

### `GET /books/{id}` (requires `get_current_user`)

- **Returns:**
  - If `current_user.id == book.owner_id`: full object incl. true `location`
  - Else: object with `public_location` only (`location` field omitted entirely from the
    response schema for non-owners — not just nulled, to make leakage structurally
    impossible per the security doc's pattern)
- **Logic:** 404 if not found or `deleted_at IS NOT NULL` (no distinction between
  "doesn't exist" and "soft-deleted" — same as other modules' 404 convention)

### `PATCH /books/{id}` (owner only)

- **Body:** any subset of `title`, `author`, `isbn`, `description`, `category`, `language`,
  `condition`, `is_available`, `location`
- **Logic:** 404 if caller isn't the owner (or book doesn't exist/is deleted) — never 403, per
  existing convention of not leaking existence. If `location` changes, recompute
  `public_location` and re-validate the TR bounding box.

### `DELETE /books/{id}` (owner only)

- **Logic:** sets `deleted_at = now()`. 404 if not owner / not found / already deleted.
  **No exchange-activity guard yet** — Phase 4 adds "delete blocked while exchange active"
  when exchanges exist.

---

## 3. Location Handling

**Static blur** (write-time, in `service.py`, per `LOCATION_AND_MAPS_PLAN.md` §1):

```python
def blur(lat: float, lng: float, grid: float = 0.01) -> tuple[float, float]:
    """Snap to ~1.1 km grid. Static: same input -> same output."""
    return round(lat / grid) * grid, round(lng / grid) * grid
```

**Turkey bounding-box validation** (write-time, in `service.py`):

```python
def in_turkey_bbox(lat: float, lng: float) -> bool:
    return 35.8 <= lat <= 42.1 and 25.7 <= lng <= 44.8
```

A small `app/core/geo.py` (or `modules/books/geo.py`) holds both helpers plus a
`(lng, lat)` ↔ `(lat, lng)` conversion wrapper for PostGIS `ST_MakePoint`, per the
"#1 geospatial bug" warning in the location plan — raw coordinate order appears in exactly
one file.

Full polygon geofence (`country_boundaries` + `ST_Contains`) is deferred to Phase 5
(Meetup module), which needs it for meetup points regardless. Books validation can be
upgraded to use it then with no schema change (same bounding-box-first pattern).

---

## 4. Mobile UI

**New dependencies:** `react-native-maps`, `expo-location`.

### Profile tab (`src/app/tabs/profile.tsx`)

Add a "My Books" section: list of own books (`useQuery(['books','me'])`), each row shows
title, author, condition badge, availability badge. Empty state if no books. "+ Add book"
button navigates to `book/new`.

### `src/app/book/new.tsx` — create form

Fields: title, author, ISBN (plain text input — scanning is sub-project #3), description,
category picker (fixed enum, i18n labels), language picker (tr/en), condition picker,
"Set location" button → opens the location picker. On submit, calls `POST /books`
(generated OpenAPI client), invalidates `['books','me']`, navigates back to Profile.

No photo section — per the agreed scope, listings can be created with zero photos this slice.

### `src/app/book/location-picker.tsx` — map picker

- Full-screen `react-native-maps` view.
- On mount: request `expo-location` when-in-use permission (with explainer per the location
  plan's "ask at moment of need" pattern). If granted, center on device GPS; if denied,
  center on Istanbul (41.0082, 28.9784).
- Draggable pin. On drag-end, reverse-geocode via `expo-location.reverseGeocodeAsync` and
  show the resulting label below the map.
- "Confirm" button returns `{ lat, lng, label }` to the create/edit form (via Expo Router
  params or a shared form-state store).
- If the backend rejects the location (`LOCATION_OUTSIDE_TURKEY`), the create form shows an
  inline error and the user must re-open the picker.

### `src/app/book/[id].tsx` — detail/edit

- Fetches `GET /books/{id}` (`useQuery(['books', id])`).
- Shows all fields; edit mode toggles fields to editable inputs (reusing the same
  pickers/components as the create form), "Save" calls `PATCH /books/{id}`.
- Availability toggle (switch) — calls `PATCH` with `is_available`.
- "Delete" button → confirmation dialog → `DELETE /books/{id}` → invalidate `['books','me']`
  → navigate back to Profile.

### i18n

`tr`/`en` resource files get keys for: category labels (6 + "other"), condition labels (4),
language labels (tr/en), form field labels, location-picker copy, delete confirmation,
error messages (incl. `LOCATION_OUTSIDE_TURKEY`).

---

## 5. Implementation Order (Vertical Slices)

| # | Slice | Files Created/Modified | Test Coverage |
|---|---|---|---|
| 1 | **Migration + models** | Alembic migration for `books` table + `book_category`/`book_condition` enums; `modules/books/models.py` | Migration runs cleanly; `alembic check` passes |
| 2 | **Backend CRUD module** | `modules/books/{schemas,repository,service,router}.py`; `core/geo.py` (blur + bbox helpers); `main.py` (register router) | `tests/books/test_create.py`, `test_list_me.py`, `test_detail.py`, `test_edit.py`, `test_delete.py` — incl. blur correctness, bbox rejection, ownership 404s, soft-delete exclusion |
| 3 | **Mobile foundations** | deps install (`react-native-maps`, `expo-location`), OpenAPI client regen, i18n keys for categories/conditions/language | type-check passes; client types match backend schema |
| 4 | **My Books on Profile** | `src/app/tabs/profile.tsx` (My Books section), query hook | component test: empty state, populated list |
| 5 | **Create flow** | `src/app/book/new.tsx`, `src/app/book/location-picker.tsx` | component tests: form validation, location picker confirm (mocked location), submit flow |
| 6 | **Detail/edit/delete** | `src/app/book/[id].tsx` | component tests: view, edit, availability toggle, delete confirmation |

---

## 6. Definition of Done

- [ ] Migration runs cleanly on a fresh DB; `alembic check` passes
- [ ] `POST /books` rejects locations outside the Turkey bounding box with
      `400 LOCATION_OUTSIDE_TURKEY`
- [ ] `public_location` is a static function of input lat/lng (same input → same output,
      tested)
- [ ] Non-owner `GET /books/{id}` response never contains the `location` field (structurally
      absent from the schema, tested)
- [ ] `GET/PATCH/DELETE /books/{id}` return 404 for non-owners and for soft-deleted books
- [ ] `GET /books/me` excludes soft-deleted books
- [ ] Mobile: register → create a book (incl. location picker) → see it in My Books → edit →
      toggle availability → delete, all working on a device against the local backend
- [ ] All new code passes ruff/mypy/eslint/tsc; backend + mobile test suites green
