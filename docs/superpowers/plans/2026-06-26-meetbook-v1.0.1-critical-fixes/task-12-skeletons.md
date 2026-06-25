# Task 12: Add skeleton loading to spinner-only screens

**Files:**
- Modify: `mobile/src/app/book/[id].tsx` (loading branch)
- Modify: `mobile/src/app/exchange/[id].tsx` (loading branch)
- Modify: `mobile/src/app/chat/[id].tsx` (loading branch in ListEmptyComponent)
- Test: append to each screen's existing test file

The design system spec (`Meetbook.md` §8) says "Loading states are skeletons (never bare spinners on lists)." Three screens violate this: book detail, exchange detail, and chat conversation all render `<ActivityIndicator>` while loading. Replace with `Skeleton` blocks. The `Skeleton` component already exists (`variant="card"` or `"list-item"`).

- [ ] **Step 1: Add a failing test for book detail skeleton**

Append to `mobile/src/app/book/__tests__/book-detail.test.tsx`:

```typescript
it('shows skeleton cards while loading (not a bare spinner)', async () => {
  jest.clearAllMocks();
  const { getBook } = require('@/lib/api/client');
  // Never resolves → stays in loading state
  getBook.mockReturnValue(new Promise(() => {}));
  useAuthStore.setState({ user: { id: 'user-1', name: 'Me', email: 'me@example.com' } as any });

  const { findByTestId, queryByTestId } = renderWithQueryClient(<BookDetailScreen />);
  expect(await findByTestId('skeleton-card')).toBeTruthy();
  expect(queryByTestId('loading-spinner')).toBeNull();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- book-detail.test.tsx`
Expected: FAIL — no `skeleton-card` testID; the screen renders an `ActivityIndicator`.

- [ ] **Step 3: Replace book detail spinner with skeletons**

In `mobile/src/app/book/[id].tsx`, find the loading branch (search for `ActivityIndicator` or `isLoading` near the top of the render). It currently renders something like:

```tsx
  if (isLoading) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }
```

Replace with skeleton cards (import `Skeleton` from `@/components/ui` if not already imported, and `ScrollView`):

```tsx
  if (isLoading) {
    return (
      <ScrollView
        style={[styles.container, { backgroundColor: colors.background }]}
        contentContainerStyle={{ padding: spacing.md }}
      >
        <Skeleton variant="card" />
        <Skeleton variant="card" />
      </ScrollView>
    );
  }
```

Ensure `Skeleton` and `spacing` are imported (check the existing `@/components/ui` import line — `Skeleton` may already be imported; `spacing` comes from tokens).

- [ ] **Step 4: Add a failing test for exchange detail skeleton**

Append to `mobile/src/app/exchange/__tests__/[id].test.tsx`:

```typescript
it('shows skeleton while loading, not a bare spinner', async () => {
  jest.clearAllMocks();
  const { getExchange } = require('@/lib/api/client');
  getExchange.mockReturnValue(new Promise(() => {}));
  useAuthStore.setState({ user: { id: 'me', name: 'Me', email: 'me@example.com' } as any });

  const { findByTestId, queryByTestId } = renderWithQueryClient(<ExchangeDetailScreen />);
  expect(await findByTestId('skeleton-card')).toBeTruthy();
  expect(queryByTestId('loading-spinner')).toBeNull();
});
```

- [ ] **Step 5: Replace exchange detail spinner**

In `mobile/src/app/exchange/[id].tsx`, find the `isLoading` branch (search for `ActivityIndicator`). Replace the spinner block with:

```tsx
  if (isLoading) {
    return (
      <ScrollView
        style={[styles.container, { backgroundColor: colors.background }]}
        contentContainerStyle={{ padding: spacing.md }}
      >
        <Skeleton variant="card" />
        <Skeleton variant="card" />
      </ScrollView>
    );
  }
```

Import `Skeleton` and `spacing` from `@/components/ui` / tokens if missing.

- [ ] **Step 6: Add a failing test for chat detail skeleton**

Append to `mobile/src/app/chat/__tests__/chat-detail.test.tsx`:

```typescript
it('shows skeleton list items while messages load, not a bare spinner', async () => {
  const { getMessages } = require('@/lib/api/chat');
  getMessages.mockReturnValue(new Promise(() => {}));

  const { findByTestId, queryByTestId } = renderChat();
  expect(await findByTestId('skeleton-list')).toBeTruthy();
  expect(queryByTestId('loading-spinner')).toBeNull();
});
```

- [ ] **Step 7: Replace chat detail spinner**

In `mobile/src/app/chat/[id].tsx`, find the `ListEmptyComponent` for the loading state (around line ~443-450, the `isLoading ?` branch inside `ListEmptyComponent`). It renders an `ActivityIndicator`. Replace with skeleton list items:

```tsx
          isLoading ? (
            <View style={{ padding: spacing.md }}>
              <Skeleton variant="list-item" />
              <Skeleton variant="list-item" />
              <Skeleton variant="list-item" />
            </View>
          ) : (
```

Import `Skeleton` from `@/components/ui` and `spacing` from tokens if missing.

- [ ] **Step 8: Run all three test files to verify they pass**

Run: `npm test -- book-detail.test.tsx exchange/__tests__ chat-detail.test.tsx`
Expected: PASS for all.

- [ ] **Step 9: Commit**

```bash
git add mobile/src/app/book/[id].tsx mobile/src/app/exchange/[id].tsx mobile/src/app/chat/[id].tsx mobile/src/app/book/__tests__/book-detail.test.tsx mobile/src/app/exchange/__tests__/[id].test.tsx mobile/src/app/chat/__tests__/chat-detail.test.tsx
git commit -m "feat(ui): replace bare spinners with skeleton loading on book/exchange/chat detail"
```
