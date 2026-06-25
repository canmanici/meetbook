# Task 14: Add pull-to-refresh to remaining list screens

**Files:**
- Modify: `mobile/src/app/user/[id].tsx` (ScrollView)
- Modify: `mobile/src/app/wishlist/index.tsx` (ScrollView)
- Modify: `mobile/src/app/book/[id].tsx` (ScrollView — owner view with pending requests)
- Modify: `mobile/src/app/exchange/[id].tsx` (ScrollView)
- Modify: `mobile/src/app/settings/blocked-users.tsx` (ScrollView/FlatList)
- Test: one representative test per screen (append)

`my-books` and `chats` already have `RefreshControl`. Five more list screens lack it: user profile, wishlist, book detail, exchange detail, blocked-users. Add `RefreshControl` to each `ScrollView` that drives a query, wired to `refetch` from `useQuery`.

- [ ] **Step 1: Add a failing test for wishlist pull-to-refresh**

Append to `mobile/src/app/wishlist/__tests__/wishlist.test.tsx`:

```typescript
it('supports pull-to-refresh that refetches wishlist', async () => {
  const { getWishlist } = require('@/lib/api/client');
  getWishlist.mockClear();
  const { findByTestId } = renderWishlist();
  // Wait for initial load
  await waitFor(() => expect(getWishlist).toHaveBeenCalledTimes(1));

  const scroll = await findByTestId('wishlist-scroll');
  // Simulate pull-to-refresh
  const RefreshControl = require('react-native').RefreshControl;
  // Trigger the onRefresh callback
  scroll.props.refreshControl.props.onRefresh();
  await waitFor(() => expect(getWishlist).toHaveBeenCalledTimes(2));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- wishlist.test.tsx`
Expected: FAIL — `wishlist-scroll` testID or `refreshControl` not found.

- [ ] **Step 3: Add RefreshControl to wishlist**

In `mobile/src/app/wishlist/index.tsx`:

Add `RefreshControl` to the `react-native` import.

Get `refetch` from the wishlist query (modify the `useQuery` destructure):
```typescript
  const { data: wishlistData, isLoading: wishlistLoading, refetch: refetchWishlist } = useQuery({
    queryKey: ['wishlist'],
    queryFn: getWishlist,
  });
```

Add a `refreshing` state:
```typescript
  const [refreshing, setRefreshing] = useState(false);
```
(import `useState` if not present — it is, line 3).

Add a handler:
```typescript
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([refetchWishlist()]);
    } finally {
      setRefreshing(false);
    }
  }, [refetchWishlist]);
```
(import `useCallback` from 'react').

Find the main `ScrollView` and add `testID="wishlist-scroll"` + a `refreshControl` prop:

```tsx
      <ScrollView
        testID="wishlist-scroll"
        style={styles.container}
        contentContainerStyle={{ paddingTop: insets.top }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} colors={[colors.primary]} tintColor={colors.primary} />
        }
      >
```

- [ ] **Step 4: Run the wishlist test to verify it passes**

Run: `npm test -- wishlist.test.tsx`
Expected: PASS.

- [ ] **Step 5: Repeat for the other 4 screens**

Apply the **same pattern** to each. For each screen:

1. Add `RefreshControl` to the `react-native` import.
2. Get `refetch` from the primary `useQuery` (add `refetch` to the destructure).
3. Add `const [refreshing, setRefreshing] = useState(false);`
4. Add a `handleRefresh` callback that sets refreshing, calls `refetch()` (or `queryClient.invalidateQueries` if multiple queries), resets refreshing.
5. Add `refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} colors={[colors.primary]} tintColor={colors.primary} />}` to the main `ScrollView`.

Screens + their primary query keys:
- `mobile/src/app/user/[id].tsx` → query `['user', id]` (`getUser`)
- `mobile/src/app/book/[id].tsx` → query `['book', id]` (`getBook`)
- `mobile/src/app/exchange/[id].tsx` → query `['exchange', id]` (`getExchange`)
- `mobile/src/app/settings/blocked-users.tsx` → query `['blocked-users']` (`listBlockedUsers`)

For each, if the screen has multiple queries that should refresh together (e.g. book detail has book + pending requests), use `queryClient.invalidateQueries()` in the handler instead of a single `refetch`.

- [ ] **Step 6: Add a smoke test for blocked-users pull-to-refresh**

Append to `mobile/src/app/settings/__tests__/blocked-users.test.tsx` (create if missing, following the wishlist test pattern):

```typescript
it('supports pull-to-refresh', async () => {
  const { listBlockedUsers } = require('@/lib/api/client');
  listBlockedUsers.mockClear();
  const { findByTestId } = renderBlockedUsers();
  await waitFor(() => expect(listBlockedUsers).toHaveBeenCalledTimes(1));
  const scroll = await findByTestId('blocked-scroll');
  scroll.props.refreshControl.props.onRefresh();
  await waitFor(() => expect(listBlockedUsers).toHaveBeenCalledTimes(2));
});
```

- [ ] **Step 7: Run all affected tests**

Run: `npm test -- wishlist blocked-users`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add mobile/src/app/user/[id].tsx mobile/src/app/wishlist/index.tsx mobile/src/app/book/[id].tsx mobile/src/app/exchange/[id].tsx mobile/src/app/settings/blocked-users.tsx mobile/src/app/wishlist/__tests__/wishlist.test.tsx mobile/src/app/settings/__tests__/blocked-users.test.tsx
git commit -m "feat(ui): add pull-to-refresh to user/wishlist/book/exchange/blocked screens"
```
