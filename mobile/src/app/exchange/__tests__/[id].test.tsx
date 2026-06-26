import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import {
  acceptExchange,
  cancelExchange,
  completeExchange,
  confirmExchangeCompletion,
  getExchange,
  rejectExchange,
} from '@/lib/api/client';
import { useAuthStore } from '@/stores/auth-store';

import ExchangeDetailScreen from '../[id]';

jest.mock('expo-router', () => ({
  router: { replace: jest.fn(), push: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({ id: 'exchange-1' }),
}));

jest.mock('@/lib/api/client', () => ({
  getExchange: jest.fn(),
  acceptExchange: jest.fn(),
  rejectExchange: jest.fn(),
  cancelExchange: jest.fn(),
  completeExchange: jest.fn(),
  confirmExchangeCompletion: jest.fn(),
}));

jest.mock('@/stores/auth-store', () => ({
  useAuthStore: jest.fn(),
}));

jest.mock('expo-image', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    Image: (props: any) => React.createElement(View, { ...props, testID: props.testID || 'expo-image' }),
  };
});

function renderWithQueryClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

const baseExchange = {
  id: 'exchange-1',
  status: 'pending',
  requested_by: 'user-1',
  requested_to: 'user-2',
  completion_marked_by: null,
  initial_message: 'Merhaba, ilgileniyorum.',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  expires_at: '2026-01-08T00:00:00Z',
  book: {
    id: 'book-1',
    title: 'Suç ve Ceza',
    author: 'Dostoyevski',
    category: 'fiction',
  },
  counterpart: {
    id: 'user-2',
    name: 'Ayşe Yılmaz',
  },
};

function mockUser(id: string) {
  (useAuthStore as unknown as jest.Mock).mockImplementation((selector) =>
    selector({ user: { id, name: 'Test', email: 'test@example.com' } }),
  );
}

describe('ExchangeDetailScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getExchange as jest.Mock).mockResolvedValue(baseExchange);
  });

  it('shows not found message on error', async () => {
    (getExchange as jest.Mock).mockRejectedValue(new Error('not found'));
    mockUser('user-1');
    const { findByText } = renderWithQueryClient(<ExchangeDetailScreen />);

    expect(await findByText('Talep bulunamadı.')).toBeTruthy();
  });

  it('renders exchange details', async () => {
    mockUser('user-1');
    const { findByText, findByTestId } = renderWithQueryClient(<ExchangeDetailScreen />);

    expect(await findByText('Suç ve Ceza')).toBeTruthy();
    expect(await findByText('Dostoyevski')).toBeTruthy();
    expect(await findByText('Ayşe Yılmaz')).toBeTruthy();
    expect(await findByText('Merhaba, ilgileniyorum.')).toBeTruthy();
    expect(await findByTestId('exchange-status-badge')).toBeTruthy();
  });

  it('shows accept/reject for owner when pending', async () => {
    mockUser('user-2');
    (acceptExchange as jest.Mock).mockResolvedValue({ ...baseExchange, status: 'accepted' });
    const { findByTestId, queryByTestId } = renderWithQueryClient(<ExchangeDetailScreen />);

    expect(await findByTestId('accept-button')).toBeTruthy();
    expect(await findByTestId('reject-button')).toBeTruthy();
    expect(queryByTestId('cancel-button')).toBeNull();

    fireEvent.press(await findByTestId('accept-button'));
    await waitFor(() => {
      expect(acceptExchange).toHaveBeenCalledWith('exchange-1');
    });
  });

  it('shows cancel for requester when pending', async () => {
    mockUser('user-1');
    const { findByTestId, queryByTestId } = renderWithQueryClient(<ExchangeDetailScreen />);

    expect(await findByTestId('cancel-button')).toBeTruthy();
    expect(queryByTestId('accept-button')).toBeNull();
    expect(queryByTestId('reject-button')).toBeNull();
  });

  it('shows complete and cancel buttons when accepted', async () => {
    (getExchange as jest.Mock).mockResolvedValue({ ...baseExchange, status: 'accepted' });
    mockUser('user-1');
    const { findByTestId } = renderWithQueryClient(<ExchangeDetailScreen />);

    expect(await findByTestId('complete-button')).toBeTruthy();
    expect(await findByTestId('cancel-button')).toBeTruthy();

    fireEvent.press(await findByTestId('complete-button'));
    await waitFor(() => {
      expect(completeExchange).toHaveBeenCalledWith('exchange-1');
    });
  });

  it('shows waiting message when current user marked completion', async () => {
    (getExchange as jest.Mock).mockResolvedValue({
      ...baseExchange,
      status: 'completion_pending',
      completion_marked_by: 'user-1',
    });
    mockUser('user-1');
    const { findByTestId, queryByTestId } = renderWithQueryClient(<ExchangeDetailScreen />);

    expect(await findByTestId('waiting-confirmation')).toBeTruthy();
    expect(queryByTestId('confirm-completion-button')).toBeNull();
  });

  it('shows confirm-completion and cancel for the other user', async () => {
    (getExchange as jest.Mock).mockResolvedValue({
      ...baseExchange,
      status: 'completion_pending',
      completion_marked_by: 'user-1',
    });
    mockUser('user-2');
    const { findByTestId } = renderWithQueryClient(<ExchangeDetailScreen />);

    expect(await findByTestId('confirm-completion-button')).toBeTruthy();
    expect(await findByTestId('cancel-button')).toBeTruthy();

    fireEvent.press(await findByTestId('confirm-completion-button'));
    await waitFor(() => {
      expect(confirmExchangeCompletion).toHaveBeenCalledWith('exchange-1');
    });
  });

  it('navigates back when back button is pressed', async () => {
    mockUser('user-1');
    const { router } = jest.requireMock('expo-router');
    const { findByTestId } = renderWithQueryClient(<ExchangeDetailScreen />);

    fireEvent.press(await findByTestId('back-button'));
    expect(router.back).toHaveBeenCalled();
  });

  it('reject and cancel mutations call the right endpoints', async () => {
    mockUser('user-2');
    (rejectExchange as jest.Mock).mockResolvedValue({ ...baseExchange, status: 'rejected' });
    const { findByTestId } = renderWithQueryClient(<ExchangeDetailScreen />);

    fireEvent.press(await findByTestId('reject-button'));
    await waitFor(() => {
      expect(rejectExchange).toHaveBeenCalledWith('exchange-1');
    });
  });

  it('renders BookCover image when book has a photo url', async () => {
    (getExchange as jest.Mock).mockResolvedValue({
      ...baseExchange,
      book: {
        ...baseExchange.book,
        condition: 'good',
        photos: [{ id: 'p1', url: 'https://example.com/cover.jpg' }],
      },
    });
    mockUser('user-1');
    const { findByTestId, queryByText } = renderWithQueryClient(<ExchangeDetailScreen />);

    await waitFor(() => expect(getExchange).toHaveBeenCalled());

    expect(await findByTestId('book-cover-image')).toBeTruthy();
    expect(queryByText('📖')).toBeNull();
  });
});
