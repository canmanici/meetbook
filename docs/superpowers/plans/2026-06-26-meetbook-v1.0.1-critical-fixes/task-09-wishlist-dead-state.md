# Task 09: Remove dead title/author state in wishlist

**Files:**
- Modify: `mobile/src/app/wishlist/index.tsx` (state at lines 25-27, add logic ~line 81-88)
- Test: `mobile/src/app/wishlist/__tests__/wishlist.test.tsx` (append)

The screen holds `title` and `author` state (lines 26-27) but renders **no inputs** for them — they're always empty strings. The `addMutation` sends them but they resolve to `undefined`. The single input is labeled "Kitap adı veya ISBN". Fix: detect whether the typed value is an ISBN (ISBN-10/13 regex) → send as `isbn`; otherwise send as `title`. Remove the dead `author` state. This makes the add flow actually useful for non-ISBN titles.

- [ ] **Step 1: Add failing tests for smart add behavior**

Append to `mobile/src/app/wishlist/__tests__/wishlist.test.tsx`:

```typescript
import { fireEvent, waitFor } from '@testing-library/react-native';

describe('WishlistScreen add behavior', () => {
  it('sends isbn when input matches ISBN-13', async () => {
    const { addToWishlist } = require('@/lib/api/client');
    const { findByTestId } = renderWishlist();
    const input = await findByTestId('wishlist-search-input');
    fireEvent.changeText(input, '9789750700001');
    const addBtn = await findByTestId('wishlist-add-button');
    fireEvent.press(addBtn);
    await waitFor(() => expect(addToWishlist).toHaveBeenCalled());
    expect(addToWishlist.mock.calls[0][0]).toMatchObject({ isbn: '9789750700001' });
    expect(addToWishlist.mock.calls[0][0].title).toBeUndefined();
  });

  it('sends title when input is not an ISBN', async () => {
    const { addToWishlist } = require('@/lib/api/client');
    const { findByTestId } = renderWishlist();
    const input = await findByTestId('wishlist-search-input');
    fireEvent.changeText(input, 'Suç ve Ceza');
    const addBtn = await findByTestId('wishlist-add-button');
    fireEvent.press(addBtn);
    await waitFor(() => expect(addToWishlist).toHaveBeenCalled());
    expect(addToWishlist.mock.calls[0][0]).toMatchObject({ title: 'Suç ve Ceza' });
    expect(addToWishlist.mock.calls[0][0].isbn).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- wishlist.test.tsx`
Expected: FAIL — `wishlist-add-button` testID not found; current code sends `isbn: isbn.trim()` always and `title: undefined`.

- [ ] **Step 3: Rewrite the add logic + add testID**

In `mobile/src/app/wishlist/index.tsx`:

Remove the `title` and `author` state lines (lines 26-27):
```typescript
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
```
Delete both lines. Only `isbn` state remains (rename it conceptually to "input" but keep the variable `isbn` to minimize churn — it holds the raw input).

In the `addMutation.onSuccess` (lines 41-47), remove the `setTitle('')` and `setAuthor('')` calls. Keep `setIsbn('')`.

Add an ISBN regex + helper near the top of the file (after the imports, before the component):

```typescript
// ISBN-10 or ISBN-13 (digits, optionally with hyphens, with optional 978/979 prefix)
const ISBN_RE = /^(?:97[89][- ]?)?(?:\d[- ]?){9}[\dX]$/;

function buildAddPayload(input: string): { isbn: string } | { title: string } {
  const trimmed = input.trim();
  const cleaned = trimmed.replace(/[- ]/g, '');
  if (/^\d{9}[\dX]$/.test(cleaned) || /^\d{13}$/.test(cleaned)) {
    return { isbn: cleaned };
  }
  return { title: trimmed };
}
```

Find the add button `onPress` (lines 81-88). It currently reads:

```tsx
          onPress={() => {
            if (isbn.trim()) {
              addMutation.mutate({
                isbn: isbn.trim(),
                title: title.trim() || undefined,
                author: author.trim() || undefined,
              });
            }
          }}
```

Replace with:

```tsx
          onPress={() => {
            if (isbn.trim()) {
              addMutation.mutate(buildAddPayload(isbn));
            }
          }}
          testID="wishlist-add-button"
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- wishlist.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/app/wishlist/index.tsx mobile/src/app/wishlist/__tests__/wishlist.test.tsx
git commit -m "fix(wishlist): remove dead title/author state, smart isbn/title detection on add"
```
