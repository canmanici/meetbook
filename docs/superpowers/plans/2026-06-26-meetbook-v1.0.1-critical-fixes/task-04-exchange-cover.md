# Task 04: Fix exchange detail inverted cover

**Files:**
- Modify: `mobile/src/app/exchange/[id].tsx` (cover block at ~line 356-364)
- Test: `mobile/src/app/exchange/__tests__/[id].test.tsx`

The cover logic is inverted: when a `coverUrl` exists it shows the 📖 emoji; when it doesn't, it shows the book icon. No `<Image>` ever renders. Fix it by using the `BookCover` component from task 03.

- [ ] **Step 1: Add a failing test for the cover render**

Open `mobile/src/app/exchange/__tests__/[id].test.tsx`. Find the existing fixtures and the `describe` block. Add a test that asserts a cover image renders when `coverUrl` is present:

```typescript
it('renders BookCover image when book has a photo url', async () => {
  jest.clearAllMocks();
  const { getExchange } = require('@/lib/api/client');
  getExchange.mockResolvedValue({
    id: 'ex-1',
    status: 'pending',
    book: {
      id: 'b1',
      title: 'Test Book',
      author: 'Test Author',
      category: 'fiction',
      condition: 'good',
      photos: [{ id: 'p1', url: 'https://example.com/cover.jpg' }],
    },
    requester: { id: 'u2', name: 'Other' },
    owner: { id: 'me', name: 'Me' },
    created_at: '2026-06-01T00:00:00Z',
  });
  useAuthStore.setState({ user: { id: 'me', name: 'Me', email: 'me@example.com' } as any });

  const { findByTestId, queryByText } = renderWithQueryClient(<ExchangeDetailScreen />);
  await waitFor(() => expect(getExchange).toHaveBeenCalled());

  expect(await findByTestId('book-cover-image')).toBeTruthy();
  // The 📖 emoji must NOT render when a real cover exists
  expect(queryByText('📖')).toBeNull();
});
```

Add `useAuthStore` import if not already present (check the test file's existing imports — follow the pattern from `book-detail.test.tsx`).

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- exchange/__tests__`
Expected: FAIL — `book-cover-image` testID not found (current code renders the emoji, not an image).

- [ ] **Step 3: Replace the inverted cover with BookCover**

In `mobile/src/app/exchange/[id].tsx`:

Add the import at the top (with other UI imports):

```typescript
import { BookCover } from '@/components/ui';
```

Find the cover block (~line 356-364). It currently reads:

```tsx
          {coverUrl ? (
            <View style={styles.coverContainer}>
              <Text style={[styles.coverPlaceholder, { color: colors.textMuted }]}>📖</Text>
            </View>
          ) : (
            <View style={[styles.coverContainer, { backgroundColor: colors.textMuted + '20' }]}>
              <Ionicons name="book-outline" size={32} color={colors.textMuted} />
            </View>
          )}
```

Replace the entire block with:

```tsx
          <View style={styles.coverContainer}>
            <BookCover url={coverUrl} size={64} />
          </View>
```

The `coverUrl` variable is already defined on line 346 (`const coverUrl = exchange.book.photos?.[0]?.url;`). `BookCover` handles null/undefined internally.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- exchange/__tests__`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/app/exchange/[id].tsx mobile/src/app/exchange/__tests__/[id].test.tsx
git commit -m "fix(exchange): render real cover via BookCover instead of inverted emoji logic"
```
