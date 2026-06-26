# Task 08: Fix wishlist "exchange iste" string

**Files:**
- Modify: `mobile/src/app/wishlist/index.tsx` (button text at line 200)

The match button reads `"exchange iste"` — half-English, half-Turkish, unfinished. Fix to `"Takas İste"` to match the app's Turkish UI (consistent with `exchange/[id].tsx` which uses "Takas İste").

- [ ] **Step 1: Write a failing test**

Create `mobile/src/app/wishlist/__tests__/wishlist.test.tsx`:

```typescript
import React from 'react';
import { render } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn() } }));
jest.mock('@/lib/api/client', () => ({
  getWishlist: jest.fn().mockResolvedValue({ items: [] }),
  addToWishlist: jest.fn(),
  removeFromWishlist: jest.fn(),
  getWishlistMatches: jest.fn().mockResolvedValue({
    matches: [
      {
        id: 'b1', isbn: '111', title: 'Matched Book', author: 'Auth',
        distance_km: 1.2, photos: [{ url: 'https://example.com/c.jpg' }],
      },
    ],
  }),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 44, bottom: 34, left: 0, right: 0 }),
}));

import WishlistScreen from '../index';

function renderWishlist() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><WishlistScreen /></QueryClientProvider>);
}

describe('WishlistScreen', () => {
  it('match button says "Takas İste", not "exchange iste"', async () => {
    const { findByText, queryByText } = renderWishlist();
    expect(await findByText('Takas İste')).toBeTruthy();
    expect(queryByText(/exchange iste/i)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- wishlist.test.tsx`
Expected: FAIL — "Takas İste" not found; "exchange iste" is rendered.

- [ ] **Step 3: Fix the string**

In `mobile/src/app/wishlist/index.tsx`, line 200, change:

```tsx
                          <Text style={styles.exchangeButtonText}>exchange iste</Text>
```

to:

```tsx
                          <Text style={styles.exchangeButtonText}>Takas İste</Text>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- wishlist.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/app/wishlist/index.tsx mobile/src/app/wishlist/__tests__/wishlist.test.tsx
git commit -m "fix(wishlist): correct half-English 'exchange iste' to 'Takas İste'"
```
