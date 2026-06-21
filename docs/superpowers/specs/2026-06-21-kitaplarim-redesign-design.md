# Kitaplarım (My Books) Page Redesign — Design Spec

**Date:** 2026-06-21
**Status:** Approved (7 visual mockups + terminal defaults reviewed and accepted by user)
**Scope:** Mobile tab page (`tabs/my-books.tsx`) — full rewrite with new component tree, optimistic delete+undo, bulk select, QR sharing
**Sub-project:** 1 of 4 (see §8 for sub-project 2/3/4 dependencies)

---

## 1. Goal

Turn the Kitaplarım page from a functional prototype into a **production-grade library management surface** where the owner can browse their books in list or grid, search/sort/filter, bulk-manage availability status, share books via QR, and confidently delete with undo — all while maintaining dark mode, accessibility (44pt targets, a11y labels), haptic feedback, and staggered entrance animations.

**What this is not:** a backend rewrite. Every data feature either works with existing endpoints or uses client-side operations. The three backend-dependent features (drag-to-reorder, shelves, analytics) are deferred to sub-projects 2-4.

---

## 2. Locked Decisions

| # | Decision | Choice | Rationale |
|---|---|---|---|
| 1 | Page structure | A — Collapsing Header | Large title + live counts subtitle, segmented Aktif/Takas tabs snap under sticky search on scroll. iOS Books feel. |
| 2 | Card interaction | Long-press → Action Sheet | Tap = detail. Long-press = bottom sheet with Toggle/Edit/Share/QR/Delete. Uses existing `Sheet` component. |
| 3 | Card density | Rich | Cover + title + author + category/condition/language pills + description excerpt (1 line) + stats line (görüntülenme · favori · X gün önce) |
| 4 | Grid view | 2-col + gradient overlay | Cover fills tile, title/author on black gradient at bottom, condition badge top-right. Goodreads style. |
| 5 | Delete model | Optimistic + Undo Toast | Deferred API call (Gmail-style). Card disappears immediately, 5s undo window fires actual `deleteBook` only on timer expiry. See §4.3. |
| 6 | Bulk select | Checkboxes + Floating Action Menu | Long-press enters select mode. Checkboxes on cards. Teal header. FAB morphs to red ⋮ menu with Toggle/Delete. |
| 7 | QR share | Full-screen modal | Centered card with cover + title + large QR + Share/Save buttons. Blurred backdrop. |
| 8 | Sort options | 4 modes: Yeni eklenen (default), A→Z, Yazar, Görüntülenme | All client-side on loaded page. |
| 9 | Edit deep-link | `?edit=1` query param | `book/[id].tsx` reads param on mount, auto-flips `editing=true`. |
| 10 | Orphan cleanup | Delete `book/my-books.tsx` | Duplicate screen with broken "Takas İste" button on own books. |
| 11 | Bulk toggle behavior | Sub-menu: "Tümünü uygun yap" / "Tümünü uygun değil yap" | Explicit target state per operation. |
| 12 | QR link format | `https://meetbook.app/book/{id}` | Universal link with web fallback for non-users. |
| 13 | Empty state style | Icon + text + CTA (no illustration) | `EmptyState` component as-is. No new assets or Lottie dep. |

---

## 3. File Structure

### Rewrite
```
mobile/src/app/tabs/my-books.tsx          — Full rewrite (~300 lines)
mobile/src/app/book/[id].tsx              — Add `?edit=1` query param support
```

### Delete
```
mobile/src/app/book/my-books.tsx          — Orphan with broken UX
```

### New files
```
mobile/src/lib/format.ts                  — timeAgo(), categoryLabel(), conditionLabel()
mobile/src/hooks/use-undo-delete.ts        — Generic optimistic-delete-with-undo hook
mobile/src/lib/qr.ts                       — QR code generation wrapper

mobile/src/components/my-books/CollapsingHeader.tsx   — Large title + subtitle + segmented tabs
mobile/src/components/my-books/MyBookCard.tsx          — List-mode Rich card
mobile/src/components/my-books/MyBookGridTile.tsx      — Grid-mode tile (2-col + overlay)
mobile/src/components/my-books/BookActionSheet.tsx     — Long-press action sheet
mobile/src/components/my-books/BookQRModal.tsx         — Full-screen QR modal
mobile/src/components/my-books/SortMenu.tsx             — Sort dropdown
mobile/src/components/my-books/BulkSelectManager.tsx   — Bulk select mode (checkboxes, header, FAB→⋮)

mobile/src/app/tabs/__tests__/my-books.test.tsx        — ~25 test cases
```

### New dependency
```
react-native-qrcode-svg                   — QR generation (Expo-compatible, native SVG)
```
Fallback: `qrcode` (pure JS, data URI via `<Image>`) if `react-native-qrcode-svg` has compatibility issues with Expo 54. Decision deferred to implementation plan.

---

## 4. Data Layer

### 4.1 Query — Infinite Scroll
Replace `useQuery` with `useInfiniteQuery`:
```typescript
const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage, refetch } =
  useInfiniteQuery({
    queryKey: ['books', 'me'],
    queryFn: ({ pageParam }) => listMyBooks({ cursor: pageParam, limit: 20 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
  });
```
Pages are flattened: `allBooks = data?.pages.flatMap(p => p.items) ?? []`.

### 4.2 Client-Side Operations
- **Filter by tab:** `activeBooks = allBooks.filter(b => b.is_available)`, `completedBooks = allBooks.filter(b => !b.is_available)`
- **Filter by search:** case-insensitive match on `title || author || isbn`
- **Sort:** Yeni eklenen (API order), A→Z (`title.localeCompare()`), Yazar (`author.localeCompare()`), Görüntülenme (`view_count` desc)
- **Limitation:** Client-side sort on paginated data is imperfect — only sorts the N loaded pages. Acceptable for typical library sizes (10–50 books). Flagged for revisit if users report 200+ books.

### 4.3 Optimistic Delete + Undo (Deferred API Call)
Precise state machine:

```
[User taps "Sil" in action sheet]
  → Remove card from local list (animation: FadeOutRight)
  → Haptics.notificationAsync(Warning)
  → Start 5s timer
  → Show toast: ""Suç ve Ceza" silindi" + "Geri Al" button + progress bar

[<5s: User taps "Geri Al"]
  → Cancel timer
  → Re-insert card at original position in list
  → Haptics.notificationAsync(Success)
  → Toast dismisses
  → NO API call was made → book was never deleted server-side

[5s: Timer expires]
  → Call deleteBook(id)
  → On success: toast dismisses, done
  → On failure: re-insert card, toast → "Silinemedi", Haptics.notificationAsync(Error)

[User navigates away during 5s window]
  → cleanup() fires delete immediately (don't lose intent)

[App crashes during 5s window]
  → Book is never deleted. Safe failure — no data loss.
```

**Bulk delete:** Same pattern, single timer per batch. Toast: "3 kitap silindi" + "Geri Al". Re-insert all on undo.

**Why not optimistic API + re-create on undo?** Re-creating via `createBook` gives a new ID, loses photos (need re-upload), and breaks pending exchange requests pointing at the old ID. Deferred-call pattern avoids all of these without backend changes.

### 4.4 Mutations
```typescript
// Toggle availability
const toggleMutation = useMutation({
  mutationFn: (book: BookOwnerView) => updateBook(book.id, { is_available: !book.is_available }),
  onMutate: async (book) => {
    await queryClient.cancelQueries({ queryKey: ['books', 'me'] });
    const prev = queryClient.getQueryData(['books', 'me']);
    // Optimistically update is_available in cache
    queryClient.setQueryData(['books', 'me'], (old: any) => toggleInCache(old, book.id));
    return { prev };
  },
  onError: (err, book, context) => {
    queryClient.setQueryData(['books', 'me'], context?.prev);
    showErrorToast();
  },
});

// Bulk operations
const bulkMutation = useMutation({
  mutationFn: (ops: BulkOp[]) => Promise.allSettled(ops.map(op => executeOp(op))),
  // Partial failure reported in toast: "3 güncellendi, 1 hata"
});
```

---

## 5. Component Tree & Interaction Flows

### 5.1 Normal Mode

```
<MyBooksTab>                              ← tabs/my-books.tsx
  <CollapsingHeader />                    ← Large title + subtitle + segmented tabs
  <View style={toolbar}>
    <SearchInput />
    <SortMenu />                          ← 4 options
    <ViewToggle />                        ← ☰ (list) | ▦ (grid)
  </View>
  <Animated.ScrollView>
    {viewMode === 'list'
      ? books.map(book => <MyBookCard />)         ← Rich card, FadeInDown stagger
      : books.map(book => <MyBookGridTile />)     ← 2-col, FadeInDown stagger
    }
    {isFetchingNextPage && <Skeleton />}
  </Animated.ScrollView>
  <FAB />                                 ← "+" → /book/new
</MyBooksTab>
```

### 5.2 Long-Press → Action Sheet Flow

```
Long-press any MyBookCard / MyBookGridTile
  → Haptics.impactAsync(Medium)
  → Long-press timer >350ms
  → If NOT in select mode → open BookActionSheet

BookActionSheet (uses existing <Sheet /> component)
  ┌─────────────────────┐
  │    (drag handle)    │
  │                     │
  │  📖 Uygunluk ↔      │ ← toggle mutation
  │  ✏️ Düzenle         │ → router.push('/book/${id}?edit=1')
  │  ↗ Paylaş           │ → Sharing.shareAsync(url)
  │  ▦ QR kod           │ → open BookQRModal
  │  🗑️ Sil             │ → optimistic delete + undo toast
  └─────────────────────┘
```

### 5.3 Bulk Select Mode

```
Long-press any card (when NOT already in select mode)
  → Haptics.impactAsync(Heavy)
  → Enter select mode

┌──────────────────────────────────────────────┐
│ ✕  2 kitap seçili           [Tümünü seç]   │  ← teal header
├──────────────────────────────────────────────┤
│ ☑ Suç ve Ceza   Dostoyevski                 │
│ ☐ Sapiens       Yuval Harari                │
│ ☑ Küçük Prens   Saint-Exupéry               │
├──────────────────────────────────────────────┤
│                                   [⋮] FAB   │  ← floating action menu
│                                              │
└──────────────────────────────────────────────┘

Tap ⋮ (FAB) → pop-up menu:
  → "Tümünü uygun yap"       ← calls updateBook with { is_available: true }
  → "Tümünü uygun değil yap" ← calls updateBook with { is_available: false }
  → "Sil (2)"                ← calls deleteBook per selected (batch undo toast)

Tap ✕ → exit select mode
Tap "Tümünü seç" → check all visible items (paginated: only loaded pages)
Tap checkbox → toggle individual item
```

### 5.4 QR Modal

```
BookQRModal (animated: backdrop fade + card scale 0.9→1.0)
┌───────────────────────────────────────────┐
│                              [✕]          │
│                                           │
│            (book cover 60x85)             │
│                                           │
│              Suç ve Ceza                  │
│              Dostoyevski                  │
│                                           │
│       ┌───────────────────────┐          │
│       │   ██ ██  ██ ██ ██    │          │
│       │   ██ ██  ██ ██ ██    │          │
│       │    ███████████████    │          │
│       │   ██ ██  ██ ██ ██    │          │  ← QR encodes:
│       │    ███████████████    │          │     https://meetbook.app/book/{id}
│       └───────────────────────┘          │
│                                           │
│     Bu kodu tarayın kitabı görüntüleyin   │
│                                           │
│    [↗ Paylaş]          [💾 Kaydet]       │
│                                           │
└───────────────────────────────────────────┘
```

---

## 6. Dark Mode & Accessibility

### 6.1 Dark Mode
- All colors from `palette.dark` — zero hardcoded hex values
- Shadows use `shadows.card` / `shadows.float` tokens (theme-agnostic `shadowColor: '#2A1F10'`)
- QR code: always black-on-white (QR scanners need contrast regardless of theme)
- Grid gradient overlay: stronger in dark mode (`rgba(0,0,0,0.88)` vs `0.75` in light) — keeps white text readable on dark covers
- Status-bar style: `light-content` in dark, `dark-content` in light

### 6.2 Accessibility
- Every interactive element: `accessibilityLabel`, `accessibilityRole`, `accessibilityHint`
- MyBookCard: `role="button"`, label = `"Suç ve Ceza, Dostoyevski, Roman, İyi durumu, Türkçe, 12 görüntülenme, 3 favori, 2 gün önce eklendi"`
- Long-press hint: `accessibilityHint="Hızlı işlemler için basılı tutun"`
- FAB: `accessibilityLabel="Yeni kitap ekle"`
- Sort button: `role="menubutton"`, menu items: `role="menuitem"`
- Tab segment: `role="tab"`, `accessibilityState={{ selected }}`
- All touch targets ≥ 44pt (verified in design tokens: minimum 44pt height/width on all interactive elements)

---

## 7. Testing Strategy

**File:** `src/app/tabs/__tests__/my-books.test.tsx`

**Suite structure:**

| Group | Tests |
|---|---|
| Loading | Shows 3 skeletons in list mode / 6 in grid mode. Stats subtitle shows "Yükleniyor..." |
| Empty | Active tab shows CTA "+ Kitap ekle". Completed tab shows "Henüz takas edilen kitap yok". |
| Error | Shows error banner with "Tekrar dene" button. Distinct from empty state. |
| Populated | Renders cards with all Rich fields visible. Renders grid tiles. |
| Tabs | Tab switch shows correct filtered books. Active badge count. |
| Search | Filters by title, author, isbn. Shows "sonuç yok" on no match. |
| Sort | 4 modes reorder cards correctly. Default = API order. |
| Long-press | Opens BookActionSheet. Each action fires correct handler. |
| Delete+Undo | Card fades out. Toast appears. Undo re-inserts card. Timer expiry fires API. API failure rolls back. |
| Bulk select | Long-press enters select mode. Checkboxes toggle. "Tümünü seç" works. Bulk delete. Bulk toggle. ✕ exits. |
| QR modal | Opens with correct data. Share/Save buttons fire correct handlers. |
| Pagination | Scroll triggers `fetchNextPage`. "Next page" skeleton shown. |
| Deep-link edit | Tapping Düzenle → `router.push('/book/${id}?edit=1')` |

**Mocks needed:**
- `expo-router` (`router.push`, `useLocalSearchParams`)
- `expo-haptics`
- `react-native-safe-area-context` (insets)
- `@/lib/api/client` (all mutations and queries)
- `expo-sharing` (shareAsync)
- `react-native-qrcode-svg` (or mock QR generation)

---

## 8. Sub-project 2/3/4 — Deferred Features

These are independent sub-projects that will be spec'd, approved, and implemented sequentially after SPEC 1 ships:

| Sub-project | Feature | Backend work | Blocked on |
|---|---|---|---|
| 2 | Drag-to-reorder | Alembic migration: `books.sort_order INT DEFAULT 0` + `PATCH /books/reorder` endpoint | SPEC 1 mobile rewrite (needs grips next to cards) |
| 3 | Shelves/collections | New `shelves` module: models, CRUD endpoints, join table | SPEC 1 mobile rewrite (needs shelves strip below header) |
| 4 | View events + analytics | New `book_view_events` table + `GET /books/me/analytics` endpoint + daily aggregation | SPEC 1 mobile rewrite (needs stats dashboard) |

All three are conceptual at this stage. SPEC 1 is the foundation they build on. No backend work starts until SPEC 1 ships.

---

## 9. Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Deferred API delete — user navigates away during 5s timer | Book not deleted | Cleanup fires delete immediately. Acceptable — book wasn't going to be deleted anyway. |
| Deferred API delete — app crashes during 5s timer | Book never deleted | Safe failure. No data loss. Book reappears on next pageload. |
| Client-side sort + infinite scroll = wrong order after page 1 | Last items on page 1 may sort before first items on page 2 | Acceptable compromise for typical library sizes. Flagged in code with comment. |
| `react-native-qrcode-svg` compat issue with Expo 54 | QR feature blocked | Fallback to `qrcode` (pure JS, data URI via `<Image>`). No native module risk. |
| Bulk delete calls N parallel API calls — rate limiting | Partial failure | `Promise.allSettled` with individual error reporting. Toast: "3 silindi, 1 hata". |
