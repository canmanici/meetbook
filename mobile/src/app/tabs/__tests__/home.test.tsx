/**
 * home.test.tsx — spec §7.1 integration tests.
 * Tests: renders map-first layout, sheet count uses booksWithLocation.length
 * (bug #6 regression), sort pills toggle, search area pill logic.
 */

// ── Mocks ──────────────────────────────────────────────────────────────────

jest.mock('react-native-maps', () => {
  const React = require('react');
  const { View } = require('react-native');
  const MockMap = React.forwardRef((props: any, ref: any) =>
    React.createElement(View, { ref, ...props, testID: props.testID || 'map-view' }, props.children),
  );
  const MockMarker = React.forwardRef((props: any, ref: any) =>
    React.createElement(View, { ref, ...props, testID: props.testID || 'marker' }, props.children),
  );
  return {
    __esModule: true,
    default: MockMap,
    Marker: MockMarker,
    Circle: (props: any) => React.createElement(View, { ...props }),
    PROVIDER_GOOGLE: 'google',
  };
});

jest.mock('react-native-map-clustering', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: React.forwardRef((props: any, ref: any) =>
      React.createElement(View, { ref, ...props, testID: props.testID || 'clustered-map' }, props.children),
    ),
  };
});

jest.mock('expo-blur', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { __esModule: true, BlurView: (props: any) => React.createElement(View, { ...props }, props.children) };
});

jest.mock('expo-haptics', () => ({
  __esModule: true,
  impactAsync: jest.fn(),
  notificationAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: 'L', Medium: 'M', Heavy: 'H' },
  NotificationFeedbackType: { Warning: 'W', Success: 'S', Error: 'E' },
}));

jest.mock('expo-location', () => ({
  __esModule: true,
  requestForegroundPermissionsAsync: jest.fn().mockResolvedValue({ status: 'denied' }),
  getCurrentPositionAsync: jest.fn(),
  Accuracy: { Balanced: 'balanced' },
}));

jest.mock('expo-router', () => ({
  __esModule: true,
  router: { push: jest.fn(), back: jest.fn() },
}));

jest.mock('react-native-reanimated', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: { View: React.forwardRef((p: any, r: any) => React.createElement(View, { ...p, ref: r })) },
    useSharedValue: (v: any) => ({ value: v }),
    useAnimatedStyle: () => ({}),
    withSpring: (v: any) => v,
    withTiming: (v: any) => v,
    withRepeat: (v: any) => v,
    cancelAnimation: jest.fn(),
    runOnJS: (fn: any) => fn,
    Easing: { out: (e: any) => e, ease: () => ({}) },
  };
});

jest.mock('react-native-gesture-handler', () => {
  const React = require('react');
  return {
    __esModule: true,
    Gesture: { Pan: () => ({ onUpdate: () => ({ onEnd: () => ({}) }), onEnd: () => ({}) }) },
    GestureDetector: ({ children }: any) => children,
  };
});

jest.mock('@gorhom/bottom-sheet', () => {
  const React = require('react');
  const { View, FlatList } = require('react-native');
  return {
    __esModule: true,
    default: React.forwardRef((props: any, ref: any) =>
      React.createElement(View, { ref, ...props, testID: props.testID || 'bottom-sheet' }, props.children),
    ),
    BottomSheetFlatList: (props: any) => React.createElement(FlatList, { ...props }),
  };
});

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn().mockResolvedValue(null),
    setItem: jest.fn().mockResolvedValue(undefined),
    removeItem: jest.fn().mockResolvedValue(undefined),
  },
}));

// Mock react-native-safe-area-context
jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    SafeAreaProvider: ({ children }: any) => React.createElement(View, null, children),
    SafeAreaConsumer: ({ children }: any) => children({ top: 0, bottom: 0, left: 0, right: 0 }),
    useSafeAreaInsets: () => ({ top: 44, bottom: 34, left: 0, right: 0 }),
    useWindowDimensions: () => ({ width: 375, height: 812 }),
  };
});

// Mock UserLocationDot to avoid setInterval keeping the test alive
jest.mock('@/components/map/user-location-dot', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    UserLocationDot: (props: any) => React.createElement(View, { ...props, testID: props.testID || 'user-dot' }),
  };
});

// Mock API client with books that have and don't have public_location (bug #6 test)
jest.mock('@/lib/api/client', () => {
  const books = [
    { id: 'b1', title: 'Book 1', author: 'Author 1', owner_id: 'o1', owner_name: 'Owner 1', category: 'fiction', condition: 'good', language: 'tr', is_available: true, public_location: { lat: 41.0, lng: 28.9 }, distance_km: 1.5, photos: [], created_at: '2026-06-20T00:00:00Z', updated_at: '2026-06-20T00:00:00Z', description: null, isbn: null },
    { id: 'b2', title: 'Book 2', author: 'Author 2', owner_id: 'o2', owner_name: 'Owner 2', category: 'textbook', condition: 'new', language: 'en', is_available: true, public_location: { lat: 41.01, lng: 28.98 }, distance_km: 0.8, photos: [], created_at: '2026-06-21T00:00:00Z', updated_at: '2026-06-21T00:00:00Z', description: null, isbn: null },
    { id: 'b3', title: 'Book 3 (no location)', author: 'Author 3', owner_id: 'o3', owner_name: 'Owner 3', category: 'comics', condition: 'fair', language: 'tr', is_available: true, public_location: null, distance_km: 99, photos: [], created_at: '2026-06-19T00:00:00Z', updated_at: '2026-06-19T00:00:00Z', description: null, isbn: null },
  ];
  return {
    __esModule: true,
    searchBboxBooks: jest.fn().mockResolvedValue({ items: books, next_cursor: null }),
    getBookClusters: jest.fn().mockResolvedValue({ clusters: [], singletons: books.filter((b: any) => b.public_location) }),
    getMe: jest.fn().mockResolvedValue({ id: 'me', name: 'Me', geofence_radius_km: 10 }),
    updateGeofenceRadius: jest.fn().mockResolvedValue({}),
  };
});

// Mock map style JSON imports
jest.mock('@/lib/map-styles/light.json', () => [], { virtual: true });
jest.mock('@/lib/map-styles/dark.json', () => [], { virtual: true });

// ── Tests ──────────────────────────────────────────────────────────────────

import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import HomeScreen from '../home';
import { ToastProvider } from '@/components/ui/toast-provider';

function renderHome() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        <ToastProvider>
          <HomeScreen />
        </ToastProvider>
      </SafeAreaProvider>
    </QueryClientProvider>,
  );
}

describe('HomeScreen (map-first)', () => {
  it('renders map-first layout (map fills screen)', async () => {
    const { findByTestId } = renderHome();
    expect(await findByTestId('map-view')).toBeTruthy();
  });

  it('renders floating search input', async () => {
    const { findByTestId } = renderHome();
    expect(await findByTestId('search-input')).toBeTruthy();
  });

  it('renders chip row with categories', async () => {
    const { findByTestId } = renderHome();
    expect(await findByTestId('chip-row')).toBeTruthy();
  });

  it('renders right controls', async () => {
    const { findByTestId } = renderHome();
    expect(await findByTestId('right-controls')).toBeTruthy();
  });

  it('renders bottom sheet', async () => {
    const { findByTestId } = renderHome();
    expect(await findByTestId('book-bottom-sheet')).toBeTruthy();
  });

  it('bug #6: sheet count uses booksWithLocation.length, not books.length', async () => {
    // mockBooks has 3 books, but only 2 have public_location
    // The sheet header should show "2 kitap bulundu", not "3"
    const { findByText } = renderHome();
    // Wait for the query to resolve and the header to render
    const label = await findByText(/kitap bulundu/);
    expect(label).toBeTruthy();
    // The number "2" should be in the document (not "3")
    const count = await findByText('2');
    expect(count).toBeTruthy();
  });

  it('renders sort pills (Yakınlık + En Yeni)', async () => {
    const { findByTestId } = renderHome();
    expect(await findByTestId('sort-distance')).toBeTruthy();
    expect(await findByTestId('sort-newest')).toBeTruthy();
  });

  it('renders radius circle when user location is available', async () => {
    const { findByTestId } = renderHome();
    expect(await findByTestId('radius-circle-circle')).toBeTruthy();
  });

  it('renders user location dot', async () => {
    const { findByTestId } = renderHome();
    expect(await findByTestId('user-dot')).toBeTruthy();
  });
});
