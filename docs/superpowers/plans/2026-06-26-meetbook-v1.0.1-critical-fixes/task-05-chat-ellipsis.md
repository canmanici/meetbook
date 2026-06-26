# Task 05: Wire chat ellipsis button to chat info

**Files:**
- Modify: `mobile/src/app/chat/[id].tsx` (ellipsis button at ~line 365-367)
- Test: `mobile/src/app/chat/__tests__/chat-detail.test.tsx` (new or existing)

The ellipsis button (`<TouchableOpacity style={styles.headerAction}>` with no `onPress`) makes the entire `/chat/info/[id]` screen unreachable. Wire it to navigate to `/chat/info/{id}`. The `id` param is the `exchangeId` (chat list taps go to `/chat/{exchange_id}`, and `chat/info/[id].tsx` destructures `{ id: exchangeId }`).

- [ ] **Step 1: Add a failing test for ellipsis navigation**

Create or open `mobile/src/app/chat/__tests__/chat-detail.test.tsx`. Use this scaffold (mocks follow the `home.test.tsx` pattern):

```typescript
import React from 'react';
import { render, waitFor, fireEvent } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({ id: 'ex-1' }),
}));
jest.mock('@/lib/api/client', () => ({
  getExchange: jest.fn().mockResolvedValue({
    id: 'ex-1', status: 'accepted',
    book: { id: 'b1', title: 'T', author: 'A', category: 'fiction', condition: 'good', photos: [] },
    requester: { id: 'u2', name: 'Other' }, owner: { id: 'me', name: 'Me' },
    created_at: '2026-06-01T00:00:00Z',
  }),
}));
jest.mock('@/lib/api/chat', () => ({
  getMessages: jest.fn().mockResolvedValue({ items: [], next_cursor: null }),
  listChats: jest.fn().mockResolvedValue({ items: [] }),
  markMessagesRead: jest.fn().mockResolvedValue(undefined),
  searchMessages: jest.fn().mockResolvedValue({ items: [] }),
}));
jest.mock('@/stores/chat-store', () => ({
  useChatStore: () => ({
    messages: {}, typing: {}, connect: jest.fn(), disconnect: jest.fn(),
    sendMessage: jest.fn(), sendTyping: jest.fn(), markMessagesRead: jest.fn(),
  }),
}));
jest.mock('@/stores/auth-store', () => ({
  useAuthStore: () => ({ user: { id: 'me', name: 'Me' } }),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 44, bottom: 34, left: 0, right: 0 }),
}));
jest.mock('expo-linear-gradient', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { LinearGradient: (p: any) => React.createElement(View, p) };
});
jest.mock('react-native-reanimated', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: { View: React.forwardRef((p: any, r: any) => React.createElement(View, { ...p, ref: r })) },
  };
});

import ChatDetailScreen from '../[id]';

function renderChat() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><ChatDetailScreen /></QueryClientProvider>);
}

describe('ChatDetailScreen', () => {
  it('ellipsis button navigates to chat info', async () => {
    const { router } = require('expo-router');
    const { findByTestId } = renderChat();
    const ellipsis = await findByTestId('chat-info-button');
    fireEvent.press(ellipsis);
    expect(router.push).toHaveBeenCalledWith('/chat/info/ex-1');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- chat-detail.test.tsx`
Expected: FAIL — `chat-info-button` testID not found (the ellipsis has no testID and no onPress).

- [ ] **Step 3: Wire the ellipsis button**

In `mobile/src/app/chat/[id].tsx`, find the ellipsis button (~line 365-367). It currently reads:

```tsx
        <TouchableOpacity style={styles.headerAction}>
          <Ionicons name="ellipsis-vertical" size={20} color={colors.textMuted} />
        </TouchableOpacity>
```

The screen already destructures the param. Find the `useLocalSearchParams` call near the top of the component (around line 100-120 — search for `useLocalSearchParams`). It returns `{ id }`. Confirm the variable name; it is `id` (the route param). `useRouter` is already imported (line 17) as `useRouter`.

Replace the ellipsis button with:

```tsx
        <TouchableOpacity
          style={styles.headerAction}
          onPress={() => router.push(`/chat/info/${id}`)}
          testID="chat-info-button"
        >
          <Ionicons name="ellipsis-vertical" size={20} color={colors.textMuted} />
        </TouchableOpacity>
```

If `id` is destructured under a different name in this file, use that name. Verify by reading the `useLocalSearchParams` line.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- chat-detail.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/app/chat/[id].tsx mobile/src/app/chat/__tests__/chat-detail.test.tsx
git commit -m "fix(chat): wire ellipsis button to open chat info screen"
```
