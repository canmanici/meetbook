# Task 15: Add error states with retry to list screens

**Files:**
- Modify: `mobile/src/app/tabs/requests.tsx`
- Modify: `mobile/src/app/tabs/chats.tsx`
- Modify: `mobile/src/app/wishlist/index.tsx`
- Modify: `mobile/src/app/settings/blocked-users.tsx`
- Test: append to each screen's test file

Four screens have **no error state at all** — when the query fails, they silently show nothing or stay on the skeleton. Add an error branch that renders `EmptyState` with a retry button calling `refetch`. The `EmptyState` component already supports `actionLabel` + `onAction` (testID `empty-state-action`).

- [ ] **Step 1: Add a failing test for requests error state**

Append to `mobile/src/app/tabs/__tests__/requests.test.tsx`:

```typescript
it('shows error state with retry when listExchanges fails', async () => {
  const { listExchanges } = require('@/lib/api/client');
  listExchanges.mockRejectedValueOnce(new Error('network'));
  // Force re-fetch to succeed on retry
  listExchanges.mockResolvedValueOnce({ items: [] });

  const { findByText, findByTestId } = renderRequests();
  expect(await findByText(/yüklenemedi/i)).toBeTruthy();
  const retryBtn = await findByTestId('empty-state-action');
  fireEvent.press(retryBtn);
  await waitFor(() => expect(listExchanges).toHaveBeenCalledTimes(2));
});
```

If `renderRequests` helper doesn't exist, add one following the `home.test.tsx` pattern (mock `@/lib/api/client` `listExchanges`, `acceptExchange`, `rejectExchange`; mock `expo-router`, `expo-linear-gradient`, `react-native-safe-area-context`).

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- requests.test.tsx`
Expected: FAIL — no error text / no retry button.

- [ ] **Step 3: Add error branch to requests**

In `mobile/src/app/tabs/requests.tsx`, modify the query destructure to capture `isError` and `refetch`:

```typescript
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['exchanges', activeTab],
    queryFn: () => listExchanges({ role: activeTab }),
    retry: false,
  });
```

Add `EmptyState` to the import if not present (it is — line 16). Add the error branch after the loading check and before the empty check:

```tsx
  if (isError) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
        <EmptyState
          message="Talepler yüklenemedi"
          description="Bağlantınızı kontrol edip tekrar deneyin."
          actionLabel="Tekrar Dene"
          onAction={() => refetch()}
          icon="cloud-offline"
        />
      </View>
    );
  }
```

- [ ] **Step 4: Run the requests test to verify it passes**

Run: `npm test -- requests.test.tsx`
Expected: PASS.

- [ ] **Step 5: Repeat for the other 3 screens**

Apply the **same pattern** to each. For each screen:

1. Add `isError` + `refetch` to the primary `useQuery` destructure. Add `retry: false` to the query options (so the error state shows immediately instead of retrying silently).
2. Import `EmptyState` if missing.
3. Add an `if (isError)` branch returning an `EmptyState` with Turkish message + "Tekrar Dene" retry button + `icon="cloud-offline"`.

Screens + messages:
- `mobile/src/app/tabs/chats.tsx` → `listChats` query → message "Sohbetler yüklenemedi"
- `mobile/src/app/wishlist/index.tsx` → `getWishlist` query → message "İstek listesi yüklenemedi"
- `mobile/src/app/settings/blocked-users.tsx` → `listBlockedUsers` query → message "Engellenen kullanıcılar yüklenemedi"

For wishlist, the error branch should wrap both the wishlist and matches queries — check both. Use the wishlist query's error for the screen-level error state.

- [ ] **Step 6: Add a smoke test for chats error state**

Append to `mobile/src/app/tabs/__tests__/chats.test.tsx`:

```typescript
it('shows error state with retry when listChats fails', async () => {
  const { listChats } = require('@/lib/api/client');
  listChats.mockRejectedValueOnce(new Error('network'));
  listChats.mockResolvedValueOnce({ items: [] });

  const { findByText, findByTestId } = renderChats();
  expect(await findByText(/yüklenemedi/i)).toBeTruthy();
  fireEvent.press(await findByTestId('empty-state-action'));
  await waitFor(() => expect(listChats).toHaveBeenCalledTimes(2));
});
```

- [ ] **Step 7: Run all affected tests**

Run: `npm test -- requests.test.tsx chats.test.tsx wishlist.test.tsx`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add mobile/src/app/tabs/requests.tsx mobile/src/app/tabs/chats.tsx mobile/src/app/wishlist/index.tsx mobile/src/app/settings/blocked-users.tsx mobile/src/app/tabs/__tests__/requests.test.tsx mobile/src/app/tabs/__tests__/chats.test.tsx mobile/src/app/wishlist/__tests__/wishlist.test.tsx
git commit -m "feat(ui): add error states with retry to requests/chats/wishlist/blocked screens"
```
