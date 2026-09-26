import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { listExchanges } from '@/lib/api/client';

import RequestsScreen from '../requests';
import { ToastProvider } from '@/components/ui/toast-provider';

jest.mock('expo-router', () => ({
  router: { replace: jest.fn(), push: jest.fn() },
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('@/lib/api/client', () => ({
  listExchanges: jest.fn(),
}));

function renderWithQueryClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>{ui}</ToastProvider>
    </QueryClientProvider>,
  );
}

const sampleItem = {
  id: 'exchange-1',
  status: 'pending',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
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

describe('RequestsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (listExchanges as jest.Mock).mockResolvedValue({ items: [], next_cursor: null });
  });

  it('shows loading skeleton initially', () => {
    const { getAllByTestId } = renderWithQueryClient(<RequestsScreen />);

    expect(getAllByTestId('skeleton-list').length).toBeGreaterThan(0);
  });

  it('shows empty state and navigates to search on action', async () => {
    const { router } = jest.requireMock('expo-router');
    const { findByText } = renderWithQueryClient(<RequestsScreen />);

    expect(await findByText('Henüz gelen talep yok')).toBeTruthy();

    fireEvent.press(await findByText('Kitaplara Göz At'));
    expect(router.push).toHaveBeenCalledWith('/tabs/home');
  });

  it('renders request rows with status badge and navigates on press', async () => {
    (listExchanges as jest.Mock).mockResolvedValue({ items: [sampleItem], next_cursor: null });
    const { router } = jest.requireMock('expo-router');
    const { findByTestId, findByText } = renderWithQueryClient(<RequestsScreen />);

    expect(await findByText('Suç ve Ceza')).toBeTruthy();
    expect(await findByText('Ayşe Yılmaz')).toBeTruthy();
    expect(await findByTestId('request-status-exchange-1')).toBeTruthy();
    expect(await findByText('Beklemede')).toBeTruthy();

    // The row itself expands the card; the "Tüm detaylar" link navigates.
    fireEvent.press(await findByTestId('request-row-exchange-1'));
    fireEvent.press(await findByTestId('detail-link-exchange-1'));
    expect(router.push).toHaveBeenCalledWith('/exchange/exchange-1');
  });

  it('switches between received and sent tabs', async () => {
    const { findByTestId } = renderWithQueryClient(<RequestsScreen />);

    await waitFor(() => {
      expect(listExchanges).toHaveBeenCalledWith({ role: 'received' });
    });

    fireEvent.press(await findByTestId('tab-sent'));

    await waitFor(() => {
      expect(listExchanges).toHaveBeenCalledWith({ role: 'sent' });
    });
  });

  it('shows error state with retry when listExchanges fails', async () => {
    (listExchanges as jest.Mock).mockRejectedValueOnce(new Error('network'));
    (listExchanges as jest.Mock).mockResolvedValueOnce({ items: [] });

    const { findByText, findByTestId } = renderWithQueryClient(<RequestsScreen />);
    expect(await findByText(/yüklenemedi/i)).toBeTruthy();
    const retryBtn = await findByTestId('empty-state-action');
    fireEvent.press(retryBtn);
    await waitFor(() => expect(listExchanges).toHaveBeenCalledTimes(2));
  });
});
