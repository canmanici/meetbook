# Task 01: Wire book detail share button

**Files:**
- Modify: `mobile/src/app/book/[id].tsx` (share button at ~line 505-510)
- Test: `mobile/src/app/book/__tests__/book-detail.test.tsx`

The share button currently has `onPress={() => {}}` — a complete no-op in a v1.0.0 APK. Wire it to `Share.share` from `react-native` with the book title + author, matching the pattern already used in `exchange/[id].tsx` (line ~340).

- [ ] **Step 1: Add a failing test for the share button**

Append to `mobile/src/app/book/__tests__/book-detail.test.tsx`, inside the `describe('BookDetailScreen', ...)` block:

```typescript
it('share button calls Share.share with book title and author', async () => {
  jest.clearAllMocks();
  const { Share } = require('react-native');
  Share.share = jest.fn().mockResolvedValue({ action: 'shared' });

  const { getBook } = require('@/lib/api/client');
  getBook.mockResolvedValue(PUBLIC_BOOK);
  useAuthStore.setState({ user: { id: 'user-1', name: 'Me', email: 'me@example.com' } as any });

  const { findByTestId } = renderWithQueryClient(<BookDetailScreen />);
  // Wait for book to load (non-owner of PUBLIC_BOOK which has owner_id 'user-2')
  const shareBtn = await findByTestId('share-button');
  await waitFor(() => expect(shareBtn.props.disabled).toBeFalsy());

  fireEvent.press(shareBtn);

  await waitFor(() => expect(Share.share).toHaveBeenCalled());
  const callArg = Share.share.mock.calls[0][0];
  expect(callArg.message).toContain('Beyaz Diş');
  expect(callArg.message).toContain('Jack London');
});
```

Add `Share` to the `react-native` import at the top of the test file if not already present (it is imported for `Alert` only — add `Share`).

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- book-detail.test.tsx` (from `mobile/`)
Expected: FAIL — `Share.share` is never called because the button is a no-op.

- [ ] **Step 3: Wire the share button**

In `mobile/src/app/book/[id].tsx`:

First, add `Share` to the `react-native` import (search the top of the file for the `react-native` import block and add `Share`).

Then find the share button (the `TouchableOpacity` with `testID="share-button"` and `onPress={() => {}}`). Replace the `onPress` with a handler:

```typescript
                  <TouchableOpacity
                    style={styles.glassButton}
                    onPress={() => {
                      const parts = [book.title];
                      if (book.author) parts.push(book.author);
                      Share.share({
                        message: `${parts.join(' — ')} · MeetBook'ta buldum!`,
                      });
                    }}
                    testID="share-button">
                    <Ionicons name="share-outline" size={20} color="#fff" />
                  </TouchableOpacity>
```

Note: `book` is already in scope (it's the loaded book object). `book.title` and `book.author` exist on the book type.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- book-detail.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/app/book/[id].tsx mobile/src/app/book/__tests__/book-detail.test.tsx
git commit -m "fix(book): wire no-op share button to Share.share"
```
