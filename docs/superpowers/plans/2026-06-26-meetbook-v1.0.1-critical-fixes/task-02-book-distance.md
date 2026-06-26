# Task 02: Compute real distance in book detail

**Files:**
- Modify: `mobile/src/app/book/[id].tsx` (distance badge at ~line 562-565)
- Modify: `mobile/src/lib/format.ts` (add `formatDistance`)
- Test: `mobile/src/lib/__tests__/format.test.ts` (new)
- Test: `mobile/src/app/book/__tests__/book-detail.test.tsx` (append)

The distance badge is hardcoded `"2.4 km"` (line 564). The API already returns `distance_km` on book objects (visible in `home.test.tsx` mock: `distance_km: 1.5`). Use the real value; hide the badge when no distance (e.g. owner viewing own book, or distance not provided).

- [ ] **Step 1: Write a failing test for `formatDistance`**

Create `mobile/src/lib/__tests__/format.test.ts`:

```typescript
import { formatDistance } from '../format';

describe('formatDistance', () => {
  it('formats a normal distance with one decimal', () => {
    expect(formatDistance(2.4)).toBe('2.4 km');
  });

  it('formats a sub-km distance with one decimal', () => {
    expect(formatDistance(0.8)).toBe('0.8 km');
  });

  it('returns null for null/undefined input', () => {
    expect(formatDistance(null)).toBeNull();
    expect(formatDistance(undefined)).toBeNull();
  });

  it('returns null for non-finite input', () => {
    expect(formatDistance(NaN)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- format.test.ts`
Expected: FAIL — `formatDistance` is not exported (module has no such function).

- [ ] **Step 3: Implement `formatDistance`**

Append to `mobile/src/lib/format.ts`:

```typescript
export function formatDistance(km: number | null | undefined): string | null {
  if (km == null || !Number.isFinite(km)) return null;
  return `${km} km`;
}
```

- [ ] **Step 4: Run the util test to verify it passes**

Run: `npm test -- format.test.ts`
Expected: PASS.

- [ ] **Step 5: Add a failing test for the book detail distance badge**

Append to `mobile/src/app/book/__tests__/book-detail.test.tsx`. First add `distance_km` to the `PUBLIC_BOOK` fixture (add this field after `public_location`):

```typescript
const PUBLIC_BOOK = {
  // ...existing fields...
  public_location: { lat: 39.93, lng: 32.86 },
  distance_km: 3.7,
  // ...
};
```

Then add this test inside the `describe` block:

```typescript
it('shows real distance from distance_km, not hardcoded 2.4 km', async () => {
  jest.clearAllMocks();
  const { getBook } = require('@/lib/api/client');
  getBook.mockResolvedValue(PUBLIC_BOOK);
  useAuthStore.setState({ user: { id: 'user-1', name: 'Me', email: 'me@example.com' } as any });

  const { findByText, queryByText } = renderWithQueryClient(<BookDetailScreen />);
  await waitFor(() => expect(getBook).toHaveBeenCalled());

  expect(await findByText('3.7 km')).toBeTruthy();
  expect(queryByText('2.4 km')).toBeNull();
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `npm test -- book-detail.test.tsx`
Expected: FAIL — the screen renders "2.4 km" hardcoded, not "3.7 km".

- [ ] **Step 7: Use real distance in book detail**

In `mobile/src/app/book/[id].tsx`, add the import at the top with other `format` imports (or add a new import line):

```typescript
import { formatDistance } from '@/lib/format';
```

Find the distance badge block (~line 562-565). It currently reads:

```tsx
            <View style={[styles.distanceBadge, { backgroundColor: colors.success + '20' }]}>
              <Ionicons name="location" size={12} color={colors.success} />
              <Text style={[styles.distanceText, { color: colors.success }]}>2.4 km</Text>
            </View>
```

Replace with a conditional that hides the badge when there's no distance (owner's own book has none). Compute once above the JSX return (place this near where `book` is available, before the `return (`):

```typescript
  const distanceLabel = !isOwner ? formatDistance((book as any).distance_km) : null;
```

Then replace the badge JSX with:

```tsx
            {distanceLabel && (
              <View style={[styles.distanceBadge, { backgroundColor: colors.success + '20' }]}>
                <Ionicons name="location" size={12} color={colors.success} />
                <Text style={[styles.distanceText, { color: colors.success }]}>{distanceLabel}</Text>
              </View>
            )}
```

Note: `distance_km` is cast via `any` because it may not yet be on the generated type; the API returns it. If the type already includes `distance_km`, drop the `as any`.

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npm test -- book-detail.test.tsx format.test.ts`
Expected: PASS for both.

- [ ] **Step 9: Commit**

```bash
git add mobile/src/app/book/[id].tsx mobile/src/lib/format.ts mobile/src/lib/__tests__/format.test.ts mobile/src/app/book/__tests__/book-detail.test.tsx
git commit -m "fix(book): show real distance_km instead of hardcoded 2.4 km"
```
