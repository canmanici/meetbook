# Map-First Home Redesign — Design Spec

**Date:** 2026-06-21
**Status:** Approved (visual mockups 1-3 reviewed and accepted by user)
**Scope:** Mobile home screen + supporting backend endpoints + geofence worker
**Decision:** Option D — "all in" (map-first home + story features + prod-grade backend with failsafes)

---

## 1. Goal

Turn the home screen from a list-with-map-toggle into a **map-first discovery surface** where the map IS the home, the list lives in a draggable bottom sheet, and every marker tells a story (category, distance, freshness, shelf grouping). Add a backend geofence worker that notifies users when a wishlist book appears near them. Fix the 8 structural bugs in the current `home.tsx` as part of the redesign.

**What this is not:** a rewrite of the books/exchanges/wishlist modules. We extend them with targeted new endpoints and one new worker module. Existing endpoints, schemas, and security posture stay intact.

---

## 2. Bugs Fixed As Part Of This Redesign

These are in the current `mobile/src/app/tabs/home.tsx` and `mobile/src/components/ui/book-marker.tsx`. Fixing them is non-negotiable — no polish on a broken base.

| # | Bug | File:Line | Fix |
|---|---|---|---|
| 1 | `clusteringEnabled={false}` — clustering lib imported but disabled | home.tsx:318 | Re-enable clustering; configure supercluster radius/levels |
| 2 | `sortBy === 'newest'` returns `0` — button does nothing | home.tsx:118-121 | Sort by `created_at` desc when `newest` selected |
| 3 | `favorites` in `useState` — lost on unmount despite `zustand` being a dep | home.tsx:45 | Move to a `useFavoritesStore` (zustand) with AsyncStorage persist |
| 4 | Double top inset — container `paddingTop: insets.top` + `floatingSearchContainer` adds it again | home.tsx:269,338 | Apply inset once, on the floating overlay only |
| 5 | `mapRegion` state set on every pan, never read — pure re-render churn | home.tsx:54,317 | Either use it (for "search this area" debounced refetch) or remove it. We use it. |
| 6 | `books.length` counts books w/o `public_location` but markers filter them out — count lies | home.tsx:321,353 | Count `booksWithLocation` separately for the sheet header |
| 7 | `recenterBtn` `bottom: spacing.xxl + 56` — magic number | home.tsx:502 | Bind to `useSafeAreaInsets().bottom + sheet peek height + spacing.md` |
| 8 | `BookMarker` `tracksViewChanges` never resets when `coverUrl` changes → stale covers | book-marker.tsx:25 | `useEffect` resetting `tracksViewChanges=true` on `thumbnailUrl`/`coverUrl` change, flip false on load |

---

## 3. Frontend Architecture

### 3.1 Screen structure

```
<View style={flex:1}>
  <MapView style={absoluteFill} />        // fills the screen
  <MapOverlay style={absoluteFill, pointerEvents:box-none}>  // transparent, only children catch taps
    <FloatingSearchAndChips insets.top />
    <RadiusCircle />                      // conditional on active radiusKm filter
    <UserLocationDot accuracy pulse />
    <RightControlStack />                 // recenter / filter / fit-all / map-type
    <SearchThisAreaPill />               // conditional on viewport drift
    <MarkerPreviewCard />               // conditional on selected marker
  </MapOverlay>
  <BottomSheet snapPoints={[collapsed, peek, half, full]}>
    <SheetHeader count sortPills />
    <SheetContent mode={peek|half|full} />  // mini-cards vs list-cards
  </BottomSheet>
</View>
```

The old `viewMode: 'list' | 'map'` state is removed. Map is always present. List is always accessible via the sheet. The `tabs/_layout.tsx` Home tab still renders this screen.

### 3.2 Map

- `react-native-maps` `MapView` with `PROVIDER_GOOGLE` (unchanged) wrapped in `ClusteredMapView` from `react-native-map-clustering` — **clustering re-enabled** (was disabled).
- `customMapStyle` prop populated from a light and dark style JSON (stored in `src/lib/map-styles/light.json` and `dark.json`). Styles are derived from `palette`: light uses `#F1EADB` base, `#D9F0E4` parks, `#DCEBF7` water, `#ECE4D6`/`#fff` streets; dark uses `palette.dark` equivalents. No bright-white map inside a dark shell.
- `showsUserLocation={false}` — we render our own user dot (accuracy ring + pulse) so it can be themed.
- `onRegionChangeComplete` writes the region to a debounced state (300ms) used by the "search this area" pill logic — fixes bug #5 by making the state useful.

### 3.3 Bottom sheet (`@gorhom/bottom-sheet`)

Four snap points, measured in `px` via `useSafeAreaInsets` + window height:

| Snap | % of window | Content | Trigger |
|---|---|---|---|
| `collapsed` | ~8% (handle only) | Just the drag handle + count badge | User swipes down to dismiss |
| `peek` | ~18% (DEFAULT) | Header (count + sort pills) + 2 horizontal mini-cards | Initial state; marker tap; preview close |
| `half` | ~45% | Header + 4-5 vertical list cards (cover, title, author, distance, category, condition, fav btn) | User drags up from peek |
| `full` | ~92% (under status bar) | Header + full scrollable list + filter chips inline | User drags up from half |

- `enableDynamicSizing={false}` — fixed snaps, no auto-grow.
- `keyboardBehavior="interactive"` + `keyboardBlurBehavior="restore"` for the search input.
- `enablePanDownToClose={false}` — sheet never fully closes (map-first means list is always one drag away).
- Backdrop: none (map stays visible above the sheet).
- The sheet reads the same `sortedBooks` data the old list consumed — no separate query.

### 3.4 Marker system

Six variants, all rendered by a refactored `BookMarker`:

| Variant | Visual | When | Data need |
|---|---|---|---|
| `standard` | 46×62 cover, 3px category-color ring, distance label above | Default single available book | existing |
| `textbook` | Same as standard, no distance label (clutter reduction at low zoom) | `category === textbook` AND `mapRegion.latitudeDelta > 0.05` | existing + zoom check |
| `fresh` | Coral pulse ring (2s loop) + "Yeni · Xsa/d" label | `created_at > now - 24h` | existing `created_at` |
| `shelf` | Stacked covers (2 behind) + `+N` badge | Books within ~30m of each other | **NEW: backend cluster endpoint** (section 4.2) |
| `unavailable` | Grayscale + ⊘ overlay, grey ring | `is_available === false` filter toggle on | existing |
| `cluster` | Count bubble, color = dominant category (computed client-side from `ClusterPoint.categories` list) | `react-native-map-clustering` supercluster output at low zoom | existing lib, re-enabled |

**Marker sizing fix:** current code uses `moderateScale(80) × moderateScale(220)` (1:2.75 ratio). Book covers are 2:3. New: `moderateScale(46) × moderateScale(62)` with 3px ring border. Removes the stretched-noodle bug.

**Category → color map** (uses existing `pastels` token set):
- fiction → `pastels.mint.ink` (#2C8C63 light / #6CD9A2 dark)
- non_fiction → `pastels.sky.ink`
- textbook → `pastels.sky.ink` (same family, distinct from non_fiction via the no-distance-label rule at low zoom)
- comics → `pastels.butter.ink`
- children → `pastels.blush.ink`
- poetry → `pastels.coral.ink`
- other → `palette.primary`

**Border theme:** light → `#fff`, dark → `palette.dark.surface` (`#211F1A`). White borders in dark mode look like floating eyes.

**Selection state:** tapping a marker scales it 1.3× with a 6px `palette.primary` glow ring, elevates z-index, and dims all other markers to 60% opacity via a `rgba(42,39,34,0.25)` overlay above the map (below the preview card).

### 3.5 Marker-tap preview card

When a marker is tapped, **do not navigate to `/book/[id]`** (current behavior). Instead:

1. Selected marker elevates (section 3.4).
2. Bottom sheet snaps to `peek`.
3. A preview card slides up over the sheet (220ms `react-native-reanimated` spring).
4. Card shows: cover (64×88), title, author, badges (distance / category / condition / fresh), 2-line description, owner row (avatar initials, name, book count, rating), two actions (Favori ghost / Takas İste primary).
5. Close: tap close button, tap map, tap another marker, or swipe down on the card.
6. Swipe up on the card → navigate to `/book/[id]` (the existing full detail page).
7. "Favori" → calls existing `POST /books/{id}/favorite` (toggle via `DELETE` if already favorited). Toast confirmation, stays on map.
8. "Takas İste" → calls existing `POST /exchanges` with `book_id` + default message placeholder. On 201, toast "Talep gönderildi" and close preview. On 409 (already requested), toast the error.

**Owner denormalization (section 4.3):** the preview card needs `owner.book_count` and `owner.rating_avg`. Today `BookSearchResult` only has `owner_id` + `owner_name`. Backend adds an `owner` sub-object to the search result.

### 3.6 Floating controls (right side, bottom-up)

Stacked column, anchored `bottom: insets.bottom + sheetPeekHeight + spacing.md`:

| Button | Icon | Action | Token |
|---|---|---|---|
| Recenter | `locate` | `animateToRegion(userLocation, 0.05 delta)` + haptic | `shadows.float` |
| Filter | `options` | Opens `FilterSheet` (existing); badge shows active filter count | `shadows.float` |
| Fit-all | `crop` | `fitToCoordinates(booksWithLocation)` animated | `shadows.float` |
| Map type | `layers` | Cycles `standard → satellite → hybrid` | `shadows.float` |

All use `shadows.float` (currently unused in the codebase) and the glassmorphism background.

### 3.7 "Search this area" pill

Appears at the top of the sheet when the map viewport drifts more than ~20% off the last queried region. Tap → re-query using the visible bounding box (section 4.1). Hides on tap or when viewport returns. Debounced 500ms after pan end to avoid flicker.

### 3.8 Radius circle

When `activeFilters.radiusKm` is set (default 10, user-adjustable 1–100 via profile settings — see section 4.5), render a `Circle` overlay (react-native-maps) centered on `userLocation` with `radius = radiusKm * 1000` (meters), stroke `palette.primary` 40% alpha dashed, fill `palette.primary` 5% alpha, plus a small label chip (e.g. "10 km") at the north edge. User sees exactly what area they're searching. The chip is tappable → opens a slider sheet for quick radius adjustment (debounced 300ms, fires `PATCH /auth/me` on release).

### 3.9 Long-press → "Add book here"

`onLongPress` on `MapView` extracts the pressed coordinate, shows a confirmation sheet ("Bu konuma kitap ekle?"), and on confirm navigates to `/book/new` with `initialLocation` pre-filled. Uses existing `POST /books`. No new endpoint needed.

### 3.10 Haptics

Install `expo-haptics`. Fire `Haptics.impactAsync(ImpactFeedbackStyle.Light)` on: marker tap, chip select, sort toggle, recenter, filter apply. Fire `Medium` on: "Takas İste" success, favorite toggle. Fire `Warning` on: error toasts.

### 3.11 Glassmorphism

All floating UI (search bar, chips, control buttons, preview card, sheet) use `backgroundColor: rgba(surface, 0.92)` + `backdropFilter: 'blur(20px)'` (light) / `rgba(palette.dark.surface, 0.85)` (dark). RN doesn't support `backdrop-filter` natively — use `@expo/vector-icons` `BlurView` from `expo-blur` (already in the Expo SDK, not currently installed as a dep — add it).

### 3.12 Zustand favorites store

New file `src/stores/favorites.ts`:
```ts
type FavoritesState = {
  ids: Set<string>;
  toggle: (id: string) => void;
  has: (id: string) => boolean;
};
```
Persisted to AsyncStorage. Replaces the `useState<Set<string>>` in home.tsx (bug #3) and is reused in the preview card, list cards, and any future screen that needs favorite state.

---

## 4. Backend Additions

Three new things. Everything else reuses existing endpoints.

### 4.1 `GET /api/v1/books/search-bbox` — bounding box search

For "search this area." Same shape as the existing `GET /books/search` but with bbox instead of radius.

**Query params:**
- `min_lat`, `max_lat`, `min_lng`, `max_lng` (floats, required, validated)
- `category`, `language`, `condition`, `q` (optional, same as existing)
- `limit` (int 1-50, default 20)
- `cursor` (optional, same encoding as existing)

**Validation & failsafes:**
- Clamp bbox area to max 50km × 50km. If larger, return `422` with message "Alan çok geniş — yakınlaştırın." Prevents whole-world DoS queries.
- Reuse the existing `Block`-aware exclusion subquery (no books from blocked users).
- Reuse `Book.deleted_at.is_(None)` + `Book.is_available.is_(True)` filters.
- PostGIS query: `func.ST_MakeEnvelope(min_lng, min_lat, max_lng, max_lat, 4326)` + `func.ST_Within(Book.public_location, envelope)`. Uses the existing GiST index on `public_location`.
- Distance column still computed (from map center, not user) so the sheet sort works.
- Rate-limited via the existing `core/rate_limit.py` — same bucket as `GET /books/search` to prevent bbox-based triangulation abuse (stalker threat from Meetbook.md §2).

**Response:** `BookSearchResponse` (reuse existing schema).

### 4.2 `GET /api/v1/books/clusters` — shelf grouping

For the bookshelf marker. Books whose `public_location` points are within ~30m of each other collapse into one shelf marker.

**Query params:** same as `search-bbox` (bbox + filters).

**Logic:**
- Server-side clustering using PostGIS: `func.ST_ClusterWithin(public_location, 30)` returns clusters of nearby points. For each cluster, return the centroid + the book ids + count + the first book's cover thumbnail (the "front" of the shelf).
- Singletons (clusters of 1) returned as individual markers so the client doesn't have to special-case them.
- Cached in Redis under `clusters:{bbox_hash}:{filters_hash}` with a 60s TTL — bbox searches are repetitive when users pan slightly.

**Response schema (new):**
```python
class ClusterPoint(BaseModel):
    centroid: LocationOutput
    book_ids: list[uuid.UUID]
    count: int
    front_cover_url: str | None
    front_thumbnail_url: str | None
    front_title: str
    categories: list[str]  # for color mixing if we want a mixed shelf

class ClusterResponse(BaseModel):
    clusters: list[ClusterPoint]  # count >= 2
    singletons: list[BookSearchResult]  # count == 1
```

**Client behavior:** render `singletons` as standard/fresh/textbook markers, `clusters` as shelf markers. Tapping a shelf snaps the sheet to peek and shows the shelf's books as the 2 mini-cards (and "show all N" expands to half).

### 4.3 Owner denormalization on search results

Extend `BookSearchResult` with an `owner` sub-object so the preview card doesn't need a second fetch:

```python
class OwnerSummary(BaseModel):
    id: uuid.UUID
    name: str
    book_count: int       # count of books where owner_id=this, is_available=true, deleted_at is null
    rating_avg: float | None  # null if rating_count < 3
    rating_count: int

class BookSearchResult(BaseModel):
    # ...existing fields...
    owner: OwnerSummary
```

**Implementation:** join `users` + aggregate `ratings` + count `books` in the search query. Adds two joins to the existing `search_nearby` query — verify explain plan still hits the GiST index first (it will, because `ST_DWithin` / `ST_Within` is the selective predicate).

### 4.4 Geofence wishlist alerts — new module `app/modules/geofence/`

**Concept:** a user adds a book to their wishlist (existing `POST /wishlist`). A background worker periodically scans: "for each wishlist entry, is there a newly-available book within X km of the wishlister's last known location?" If yes, create an in-app notification.

**New files:**
- `backend/app/modules/geofence/models.py` — `GeofenceAlert` table (id, user_id, wishlist_item_id, book_id, created_at, read_at)
- `backend/app/modules/geofence/repository.py` — queries
- `backend/app/modules/geofence/service.py` — match logic
- `backend/app/modules/geofence/router.py` — `GET /api/v1/geofence/alerts`, `POST /api/v1/geofence/alerts/{id}/read`
- `backend/app/workers/geofence_matcher.py` — the worker

**Worker logic (runs every 15 min via the existing scheduler):**
1. Load all active wishlist items (`wishlist` table, joined to `users.last_known_location`).
2. For each, query `books` where `is_available = true`, `deleted_at is null`, `ST_DWithin(public_location, user.last_known_location, radius_m)`, `created_at > wishlist_item.created_at` (only new matches — don't re-alert on old inventory), and not already in `GeofenceAlert` for this `(user_id, wishlist_item_id, book_id)`.
3. For each match, call `NotificationService.create_notification(user_id, "wishlist_match", {"book_id": ..., "wishlist_item_id": ..., "distance_km": ...})` and insert a `GeofenceAlert` row.
4. Commit.
5. Return count (matches the existing worker pattern in `expire_requests.py`).

**Failsafes:**
- Worker is idempotent — the `GeofenceAlert` unique constraint on `(user_id, wishlist_item_id, book_id)` prevents duplicate alerts even if the worker runs twice.
- Worker wraps each user's scan in a try/except — one user's failure doesn't abort the batch.
- Worker logs count + duration; does not log PII (no coords, no book titles).
- If `user.last_known_location` is null (user never granted location), skip that user — no alert.
- Radius is per-user: `User.geofence_radius_km` (Integer, nullable, default 10, validated 1–100). The worker reads this column per user. See section 4.5 for the settings endpoint + UI.
- Worker is scheduled via APScheduler in `app/main.py` lifespan (same mechanism as `expire_requests` / `loan_reminders` / `reveal_ratings`): `scheduler.add_job(_run_geofence_matcher, "interval", minutes=15)`. No new infra.
- Push notification delivery (Expo push tokens, FCM/APNs) is **out of scope** for this redesign. The worker creates in-app notifications only. Push is a separate spec.

**Security:**
- Same anti-stalker posture as the rest of the app: the worker uses `public_location` (already blurred to ~1km grid), never the true `location`.
- The `GET /geofence/alerts` endpoint requires `get_current_user` and filters by `user_id` — object-level auth, same pattern as `GET /notifications`.
- Rate-limit the worker itself: cap at 1000 users per run, sleep 100ms between users to avoid DB saturation.

### 4.5 Per-user geofence radius setting

**Concept:** users can adjust the radius of their wishlist-match geofence. Default 10 km, range 1–100 km. Exposed via the existing `PATCH /auth/me` endpoint + a slider on the profile screen + a quick-adjust sheet from the radius circle chip on the map.

**Backend:**
- New column on `users`: `geofence_radius_km = Column(Integer, nullable=False, default=10)`. Migration adds the column with `server_default="10"` so existing rows backfill.
- `MeResponse` schema extended with `geofence_radius_km: int`.
- `PATCH /auth/me` accepts optional `geofence_radius_km: int = Field(default=None, ge=1, le=100)`. On `None`, no-op. On value, update the column.
- Validation: `422` if outside 1–100. Server-side clamp is the source of truth — never trust client slider value.

**Mobile:**
- `ProfileScreen` (existing `tabs/profile.tsx`) gets a new row "Wishlist Geofence" showing the current value (e.g. "10 km") with a chevron. Tap → opens a bottom sheet with a slider (1–100, step 1), live label, and "Kaydet" button. On save → `PATCH /auth/me` with the new value → optimistic update + toast.
- Quick-adjust from the map: tapping the radius-circle label chip (section 3.8) opens the same slider sheet. Saves on release (debounced 300ms) so users don't spam the API while dragging.

**Failsafes:**
- Slider is debounced 300ms on the map quick-adjust to avoid a request per pixel drag.
- Profile save is explicit (button) — no debounce needed.
- If the PATCH fails, revert the optimistic update + error toast. The radius circle on the map snaps back.
- Worker reads the column fresh each run — no caching of per-user radius, so a settings change takes effect on the next 15-min worker tick. Document this in the UI: "Değişiklik bir sonraki kontrol döngüsünde etkili olur."

---

## 5. Failsafes & Worst-Case Scenarios

The user asked for worst-case thinking. Here it is.

### 5.1 PostGIS query scaling at 100k books

**Worst case:** 100,000 active books, user pans to a dense city center, bbox covers 50km² with 5,000 books inside.

**Defense:**
- The GiST index on `public_location` makes `ST_Within(point, envelope)` an index-only scan — sub-millisecond filter to the ~5000 candidates.
- `LIMIT 50` (max) caps the result set. Cursor pagination for "load more."
- The `clusters` endpoint caps at 500 clusters per response; if more, the client zooms out further.
- Redis cache (60s TTL) on `clusters` means a pan-then-pan-back doesn't re-query.
- Monitor: add a `slow_query_log` threshold (500ms) on these endpoints. If hit, investigate.

### 5.2 Google Maps API key failure / quota exceeded

**Worst case:** Google Maps JS key invalidates, or quota exhausted. Map tiles stop loading.

**Defense:**
- `PROVIDER_GOOGLE` requires a valid API key. On key failure, `react-native-maps` shows a blank grid. We can't fix this client-side.
- Backend `places` module already proxies Google Places with Redis caching — if Google is down, the cached responses still serve for up to 24h (extend TTL on cache miss + stale-while-revalidate).
- **Mitigation:** add a startup health check that pings the Google Maps Static API on app launch. If it fails, show a one-time toast "Harita servisi geçici olarak kullanılamıyor" and fall back to the list-only view (sheet snaps to `full`, map still renders but tiles may be missing). This is a graceful degradation, not a crash.
- **Monitoring:** backend `places` module should log Google API errors to the existing logger and expose a `/healthz/maps` check.

### 5.3 Geofence worker crash mid-batch

**Worst case:** worker processes 500 users, DB connection drops at user 450.

**Defense:**
- Each user's scan is its own DB transaction (begin → scan → commit). User 450's transaction rolls back; users 1-449 are committed.
- The `GeofenceAlert` unique constraint means a re-run won't duplicate alerts for users 1-449 — it will just re-scan and find no new matches (because the `created_at > wishlist_item.created_at` + existing alert check filters them).
- Worker is scheduled every 15 min — the next run picks up user 450+ naturally.
- Worker logs `{"processed": 449, "skipped": 0, "failed_at_user": "<uuid>"}` on crash (no PII beyond the id, which is already in logs).

### 5.4 Redis unavailable

**Worst case:** Redis crashes. Places cache, rate limiting, refresh-token denylist all fail.

**Defense:**
- `core/redis.py` returns a client; if Redis is down, commands throw `ConnectionError`. Wrap critical reads in try/except and degrade:
  - Places cache miss → fall through to Google directly (slower but functional).
  - Rate limit → fail open (allow the request, log a warning). Better than locking all users out.
  - Refresh-token denylist → fail closed (reject refreshes). Better than allowing a revoked token.
- `clusters` endpoint cache → on Redis miss, query PostGIS directly (slower, still correct).
- **Monitoring:** `get_redis().ping()` in the health check; alert on failure.

### 5.5 DB connection pool exhaustion

**Worst case:** 200 concurrent map-pan events each trigger a `search-bbox` query.

**Defense:**
- The 300ms debounce on `onRegionChangeComplete` (section 3.2) means 200 pans become at most ~1 query per 300ms per user, not 200 simultaneous.
- "Search this area" requires a tap, not just a pan — further throttles.
- Async SQLAlchemy pool with `pool_size=20, max_overflow=10` (verify in `core/db.py`) handles 30 concurrent queries; the rest queue.
- `limit=50` on every search query caps query time.
- Frontend `@tanstack/react-query` `staleTime: 60_000` + deduplication means identical concurrent queries share one network call.

### 5.6 Malicious bbox / whole-world query

**Worst case:** attacker sends `min_lat=-90, max_lat=90, min_lng=-180, max_lng=180` to fetch all books.

**Defense:**
- Bbox area clamp (section 4.1) returns `422` for anything > 50km × 50km.
- Even within the clamp, `LIMIT 50` caps the response.
- Rate-limited in the same bucket as `GET /books/search` — repeated bbox probing triggers the same throttle as radius probing (stalker defense from Meetbook.md §2).
- `public_location` is already blurred — bbox queries don't leak more precision than the existing radius search.

### 5.7 Stalker triangulation via repeated bbox queries

**Worst case:** stalker pans the map in tiny increments around a target's book, averaging the "1.2 km" distance labels to triangulate the true location.

**Defense:**
- `public_location` is already blurred to a ~1km grid (existing `core/geo.blur()`). Distance is computed from the blurred point, not the true point. Triangulating the blurred point is harmless — that's the point of blurring.
- Distance labels are rounded (existing behavior — verify in the search service). "1.2 km" is already approximate.
- Rate limit on `search-bbox` caps probe attempts per minute.

### 5.8 Photo / cover image load failure

**Worst case:** S3 down, all marker cover images fail.

**Defense:**
- `BookMarker` already has an `onError` fallback (existing). The placeholder shows `palette.dark.surface` — fine.
- The preview card cover does the same.
- No retry storm — `expo-image` (already a dep) caches and handles errors gracefully.

### 5.9 Map gesture conflict with chip row

**Worst case:** user tries to scroll the chip row horizontally near the map edge → map pans instead.

**Defense:**
- Chip row is inside a `ScrollView` with `horizontal` + `waitFor` ref pointing to the pan gesture handler. React Native Gesture Handler (already a dep) prioritizes the inner scroll.
- The floating overlay uses `pointerEvents="box-none"` so taps pass through to the map except where children explicitly catch them.

### 5.10 Preview card + sheet gesture conflict

**Worst case:** user swipes down on the preview card → does it close the card or collapse the sheet?

**Defense:**
- The preview card has its own pan gesture (Reanimated). Swipe down with velocity > threshold → close the card. Swipe down slow → bubble the gesture to the sheet (which collapses from peek to handle).
- Swipe up on the card with velocity → navigate to `/book/[id]`.
- Swipe up slow → bubble to sheet (expands peek → half).
- This is standard `@gorhom/bottom-sheet` + Reanimated gesture composition — the lib is designed for it.

---

## 6. Data Model Changes

### 6.1 New table: `geofence_alerts`

```sql
CREATE TABLE geofence_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    wishlist_item_id UUID NOT NULL REFERENCES wishlist_items(id) ON DELETE CASCADE,
    book_id UUID NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    read_at TIMESTAMPTZ,
    UNIQUE (user_id, wishlist_item_id, book_id)  -- idempotency
);
CREATE INDEX idx_geofence_alerts_user_unread ON geofence_alerts (user_id) WHERE read_at IS NULL;
```

### 6.2 New column on `users`

```sql
ALTER TABLE users
  ADD COLUMN geofence_radius_km INTEGER NOT NULL DEFAULT 10
  CHECK (geofence_radius_km BETWEEN 1 AND 100);
```

Both changes ship in one Alembic migration in `backend/alembic/versions/`.

### 6.2 Extended schema: `BookSearchResult.owner`

No DB change — computed via join in the repository query. Schema-only change in `schemas.py`.

### 6.3 New endpoints registration

`backend/app/main.py` adds:
```python
app.include_router(books_router, prefix="/api/v1")  # existing, now with /search-bbox and /clusters
app.include_router(geofence_router, prefix="/api/v1")  # NEW
```

---

## 7. Testing Strategy

### 7.1 Frontend (Jest + @testing-library/react-native — existing setup)

- `home.test.tsx` — renders map-first layout, verifies sheet snap points, verifies marker count badge uses `booksWithLocation.length` not `books.length` (bug #6 regression test).
- `book-marker.test.tsx` — all 6 variants render correct ring color + label + fresh pulse class; `tracksViewChanges` resets on `thumbnailUrl` change (bug #8 regression test).
- `favorites-store.test.ts` — toggle, has, persistence round-trip (bug #3 regression test).
- `marker-preview-card.test.tsx` — renders owner row, fires `onFavorite` and `onRequestExchange`, closes on close button / map tap / swipe down.
- `bottom-sheet.test.tsx` — snaps to correct point on marker tap, sort pill toggle, "search this area" pill appears on viewport drift.
- Mock `react-native-maps`, `@gorhom/bottom-sheet`, `expo-haptics`, `expo-blur` in jest config (extend existing `jest-expo` setup).

### 7.2 Backend (pytest — existing setup)

- `test_search_bbox.py` — happy path, bbox area clamp (>50km → 422), blocked-user exclusion, cursor pagination, rate limit.
- `test_clusters.py` — cluster of 3 books within 30m → 1 cluster + 0 singletons; cluster of 1 → 0 clusters + 1 singleton; Redis cache hit/miss.
- `test_owner_summary.py` — search result includes `owner.book_count` + `owner.rating_avg` with correct aggregation.
- `test_geofence_worker.py` — happy path (wishlist item + new nearby book → alert created), idempotency (run twice → 1 alert), user without location skipped, worker crash mid-batch (mock DB drop → first N committed, rest rolled back).
- `test_geofence_router.py` — `GET /alerts` requires auth + filters by user, `POST /alerts/{id}/read` marks read.
- `test_geofence_settings.py` — `PATCH /auth/me` with `geofence_radius_km` in range updates column; out-of-range (0, 101) → 422; worker uses the per-user value (user A with 5km + book at 7km → no alert; user B with 10km + same book → alert).

### 7.3 Manual QA checklist

- [ ] Light mode: map style matches palette, markers legible, glass UI blurs correctly.
- [ ] Dark mode: map style matches `palette.dark`, marker borders flip to `palette.dark.surface`, no white borders.
- [ ] Sheet snaps: drag from peek → half → full → half → peek → collapsed works smoothly.
- [ ] Marker tap: preview card appears, other markers dim, sheet snaps to peek.
- [ ] Marker tap on shelf: sheet shows the shelf's books.
- [ ] Long-press map: "add book here" sheet appears, navigates to `/book/new` with location pre-filled.
- [ ] "Search this area" pill: appears on pan, hides on tap, re-queries bbox.
- [ ] Radius circle: visible when `radiusKm` filter set, hidden when cleared. Label chip tappable → opens quick-adjust slider sheet.
- [ ] Geofence radius setting: profile screen row shows current value, slider sheet saves via `PATCH /auth/me`, value persists across sessions, map quick-adjust updates the circle live.
- [ ] Haptics: fire on all interactions listed in section 3.10.
- [ ] Geofence worker: add wishlist item, add a nearby book as a different user, wait for worker run, verify notification appears.
- [ ] Worst case: kill Redis, verify places + clusters degrade gracefully (slow but functional).

---

## 8. Dependencies to Add

### Mobile (`mobile/package.json`)
- `expo-haptics` (~13.x) — haptic feedback
- `expo-blur` (~13.x) — glassmorphism `BlurView`
- `@gorhom/bottom-sheet` — already installed, finally used

### Backend (`backend/pyproject.toml`)
- No new deps. PostGIS `ST_ClusterWithin` and `ST_MakeEnvelope` are built-in. Redis already used.

---

## 9. Out of Scope

These came up during design but are explicitly deferred:

- **Push notifications** (Expo push tokens, FCM/APNs) — the geofence worker creates in-app notifications only. Push delivery is a separate spec.
- **"Books near my route"** (draw a path, find books along it) — needs a route API + backend `ST_LineLocatePoint` query. Future spec.
- **Heatmap layer** — needs backend density endpoint + `react-native-maps` `Heatmap` (Google provider only). Future spec.
- **Owner-avatar markers as a toggle** — the data is there (section 4.3) but the marker variant is not built. Future.
- **Multiple saved geofence areas** — in-scope is a single per-user radius around the user's last-known location (section 4.5). Drawing multiple user-defined circles on the map with independent radii is a future iteration.
- **Shareable deep-link locations** — separate spec.

---

## 10. Rollout

Single PR, single release. The home screen is a tab — no router change. Backend migrations are additive (new table, new endpoints, schema extension). No breaking changes to existing endpoints.

**Rollback:** revert the mobile commit + revert the backend migration. Existing app version continues to work against the old backend; new backend is forward-compatible (new endpoints, extended schema field is optional for old clients).

---

## 11. Open Questions for Implementation

None blocking. The design is complete. The implementation plan (next step) will sequence the work into vertical slices.
