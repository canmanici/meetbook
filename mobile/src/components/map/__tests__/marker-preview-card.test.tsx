/**
 * marker-preview-card.test.tsx — spec §7.1 extended tests.
 * Tests: renders owner row, fires favorite API, fires exchange API,
 * closes on close button, renders badges.
 */

// Mock API client
jest.mock('@/lib/api/client', () => ({
  __esModule: true,
  addFavorite: jest.fn().mockResolvedValue(undefined),
  removeFavorite: jest.fn().mockResolvedValue(undefined),
  createExchange: jest.fn().mockResolvedValue({ id: 'ex-1' }),
}));

// Mock AsyncStorage (needed by favorites store)
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn().mockResolvedValue(null),
    setItem: jest.fn().mockResolvedValue(undefined),
    removeItem: jest.fn().mockResolvedValue(undefined),
  },
}));

// Mock expo-haptics
jest.mock('expo-haptics', () => ({
  __esModule: true,
  impactAsync: jest.fn(),
  notificationAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: 'L', Medium: 'M', Heavy: 'H' },
  NotificationFeedbackType: { Warning: 'W', Success: 'S', Error: 'E' },
}));

// Mock expo-blur
jest.mock('expo-blur', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { __esModule: true, BlurView: (props: any) => React.createElement(View, { ...props }, props.children) };
});

// Mock react-native-gesture-handler
jest.mock('react-native-gesture-handler', () => {
  const React = require('react');
  return {
    __esModule: true,
    Gesture: { Pan: () => ({ onUpdate: () => ({ onEnd: () => ({}) }), onEnd: () => ({}) }) },
    GestureDetector: ({ children }: any) => children,
  };
});

// Mock react-native-reanimated
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
    runOnJS: (fn: any) => fn,
  };
});

import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import MarkerPreviewCard, { type PreviewBook } from '../marker-preview-card';
import { ToastProvider } from '@/components/ui/toast-provider';
import { palette } from '@/components/ui/tokens';
import { addFavorite, removeFavorite, createExchange } from '@/lib/api/client';

const mockBook: PreviewBook = {
  id: 'book-1',
  title: 'Suç ve Ceza',
  author: 'Dostoyevski',
  description: 'Klasik bir Rus romanı.',
  coverUrl: null,
  category: 'fiction',
  condition: 'good',
  distanceKm: 2.5,
  ownerId: 'owner-1',
  ownerName: 'Ahmet Yılmaz',
  ownerBookCount: 12,
  ownerRatingAvg: 4.8,
  ownerRatingCount: 5,
  isFavorited: false,
  createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(), // 3 hours ago = fresh
};

const defaultProps = {
  onClose: jest.fn(),
  onNavigateToDetail: jest.fn(),
  peekHeightPx: 150,
  insetsBottom: 20,
  colors: palette.light,
  isDark: false,
};

function renderCard(book: PreviewBook = mockBook, props: any = {}) {
  return render(
    <ToastProvider>
      <MarkerPreviewCard book={book} {...defaultProps} {...props} />
    </ToastProvider>,
  );
}

describe('MarkerPreviewCard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders book information', () => {
    const { getByText } = renderCard();
    expect(getByText('Suç ve Ceza')).toBeTruthy();
    expect(getByText('Dostoyevski')).toBeTruthy();
    expect(getByText('2.5 km')).toBeTruthy();
  });

  it('renders owner name', () => {
    const { getByText } = renderCard();
    expect(getByText('Ahmet Yılmaz')).toBeTruthy();
  });

  it('renders owner book count and rating', () => {
    const { getByText } = renderCard();
    expect(getByText('· 12 kitap')).toBeTruthy();
    expect(getByText('· ★ 4.8')).toBeTruthy();
  });

  it('renders owner initials avatar', () => {
    const { getByText } = renderCard();
    expect(getByText('AY')).toBeTruthy(); // Ahmet Yılmaz → AY
  });

  it('renders Takas İste button', () => {
    const { getByText } = renderCard();
    expect(getByText('Takas İste')).toBeTruthy();
  });

  it('renders category badge', () => {
    const { getByText } = renderCard();
    expect(getByText('Roman')).toBeTruthy(); // fiction → Roman
  });

  it('renders condition badge', () => {
    const { getByText } = renderCard();
    expect(getByText('İyi')).toBeTruthy(); // good → İyi
  });

  it('renders fresh badge for book created < 24h', () => {
    const { getByText } = renderCard();
    // Fresh badge has text "Yeni"
    expect(getByText('Yeni')).toBeTruthy();
  });

  it('renders description (2-line)', () => {
    const { getByText } = renderCard();
    expect(getByText('Klasik bir Rus romanı.')).toBeTruthy();
  });

  it('renders close button', () => {
    const { getByTestId } = renderCard();
    expect(getByTestId('preview-close')).toBeTruthy();
  });

  it('fires onClose when close button pressed', () => {
    const onClose = jest.fn();
    const { getByTestId } = renderCard(mockBook, { onClose });
    fireEvent.press(getByTestId('preview-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls addFavorite API when favorite button pressed (not favorited)', async () => {
    const { getByTestId } = renderCard(mockBook);
    fireEvent.press(getByTestId('preview-favorite'));
    await waitFor(() => {
      expect(addFavorite).toHaveBeenCalledWith('book-1');
    });
  });

  it('calls removeFavorite API when favorite button pressed (already favorited)', async () => {
    const favoritedBook = { ...mockBook, isFavorited: true };
    const { getByTestId } = renderCard(favoritedBook);
    fireEvent.press(getByTestId('preview-favorite'));
    await waitFor(() => {
      expect(removeFavorite).toHaveBeenCalledWith('book-1');
    });
  });

  it('calls createExchange API when Takas İste pressed', async () => {
    const { getByTestId } = renderCard(mockBook);
    fireEvent.press(getByTestId('preview-exchange'));
    await waitFor(() => {
      expect(createExchange).toHaveBeenCalledWith(
        expect.objectContaining({ book_id: 'book-1' }),
      );
    });
  });

  it('fires onClose after successful exchange', async () => {
    const onClose = jest.fn();
    const { getByTestId } = renderCard(mockBook, { onClose });
    fireEvent.press(getByTestId('preview-exchange'));
    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('renders Kitaba Git button', () => {
    const { getByText } = renderCard();
    expect(getByText('Kitaba Git')).toBeTruthy();
  });

  it('calls onNavigateToDetail when Kitaba Git pressed', () => {
    const onNavigateToDetail = jest.fn();
    const { getByTestId } = renderCard(mockBook, { onNavigateToDetail });
    fireEvent.press(getByTestId('preview-go-to-book'));
    expect(onNavigateToDetail).toHaveBeenCalledWith('book-1');
  });

  it('renders swipe hint text', () => {
    const { getByText } = renderCard();
    expect(getByText('↑ Yukarı kaydırarak detayları gör')).toBeTruthy();
  });
});
