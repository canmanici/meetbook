# Task 03: Create BookCover component (expo-image)

**Files:**
- Create: `mobile/src/components/ui/book-cover.tsx`
- Modify: `mobile/src/components/ui/index.ts` (export it)
- Test: `mobile/src/components/ui/__tests__/book-cover.test.tsx` (new)

Remote book covers load via raw `<Image>` with no cache, no shimmer, no fallback. `expo-image` is already in `package.json` but unused. Create a shared `BookCover` component used by task 04 (exchange detail) and future swaps. This task ONLY creates the component + tests; swapping it into screens happens in task 04.

- [ ] **Step 1: Write a failing test for BookCover**

Create `mobile/src/components/ui/__tests__/book-cover.test.tsx`:

```typescript
import React from 'react';
import { render } from '@testing-library/react-native';

// Mock expo-image before importing the component
jest.mock('expo-image', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    Image: (props: any) => React.createElement(View, { ...props, testID: props.testID || 'expo-image' }),
  };
});

import { BookCover } from '../book-cover';
import { palette } from '../tokens';

describe('BookCover', () => {
  it('renders expo-image when url is provided', () => {
    const { getByTestId } = render(<BookCover url="https://example.com/cover.jpg" />);
    expect(getByTestId('book-cover-image')).toBeTruthy();
  });

  it('renders fallback icon when url is null', () => {
    const { getByTestId, queryByTestId } = render(<BookCover url={null} />);
    expect(getByTestId('book-cover-fallback')).toBeTruthy();
    expect(queryByTestId('book-cover-image')).toBeNull();
  });

  it('renders fallback icon when url is undefined', () => {
    const { getByTestId } = render(<BookCover url={undefined} />);
    expect(getByTestId('book-cover-fallback')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- book-cover.test.tsx`
Expected: FAIL — module `../book-cover` does not exist.

- [ ] **Step 3: Create the BookCover component**

Create `mobile/src/components/ui/book-cover.tsx`:

```typescript
import React from 'react';
import { View, StyleSheet, useColorScheme } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { palette, radius } from './tokens';

export interface BookCoverProps {
  /** Remote cover URL. When null/undefined/empty, shows a fallback icon. */
  url?: string | null;
  /** Width in px. Default 64. */
  size?: number;
  /** Border radius. Default 8. */
  radius?: number;
}

export function BookCover({ url, size = 64, radius = 8 }: BookCoverProps) {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  const colors = palette[isDark ? 'dark' : 'light'];
  const hasUrl = typeof url === 'string' && url.length > 0;

  if (!hasUrl) {
    return (
      <View
        testID="book-cover-fallback"
        style={[
          styles.fallback,
          {
            width: size,
            height: size * 1.5,
            borderRadius: radius,
            backgroundColor: colors.textMuted + '20',
          },
        ]}
      >
        <Ionicons name="book-outline" size={size * 0.4} color={colors.textMuted} />
      </View>
    );
  }

  return (
    <Image
      testID="book-cover-image"
      source={{ uri: url }}
      style={{ width: size, height: size * 1.5, borderRadius: radius }}
      contentFit="cover"
      transition={200}
      cachePolicy="memory-disk"
    />
  );
}

const styles = StyleSheet.create({
  fallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- book-cover.test.tsx`
Expected: PASS.

- [ ] **Step 5: Export BookCover from the UI barrel**

In `mobile/src/components/ui/index.ts`, add (after the `Avatar` export on line 5):

```typescript
export { BookCover } from './book-cover';
export type { BookCoverProps } from './book-cover';
```

- [ ] **Step 6: Commit**

```bash
git add mobile/src/components/ui/book-cover.tsx mobile/src/components/ui/index.ts mobile/src/components/ui/__tests__/book-cover.test.tsx
git commit -m "feat(ui): add BookCover component with expo-image + fallback"
```
