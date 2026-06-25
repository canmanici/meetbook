import React from 'react';
import { render } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn() } }));
jest.mock('@/lib/api/client', () => ({
  getWishlist: jest.fn().mockResolvedValue({
    items: [{ id: 'w1', isbn: '111', title: 'My Wish', author: 'Me' }],
  }),
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
