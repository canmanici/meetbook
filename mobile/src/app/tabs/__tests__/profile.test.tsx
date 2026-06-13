import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { getMe, listMyBooks, logout, updateMe } from '@/lib/api/client';
import { clearTokens } from '@/lib/secure-store';
import { useAuthStore } from '@/stores/auth-store';

import ProfileScreen from '../profile';

jest.mock('expo-router', () => ({
  router: { replace: jest.fn(), push: jest.fn() },
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('@/lib/api/client', () => ({
  logout: jest.fn(),
  listMyBooks: jest.fn(),
  getMe: jest.fn(),
  updateMe: jest.fn(),
}));

jest.mock('@/lib/secure-store', () => ({
  clearTokens: jest.fn(),
}));

const mockClearSession = jest.fn();

const baseState = {
  user: { id: '1', name: 'Test User', email: 'test@example.com' },
  accessToken: 'access-123',
  refreshToken: 'refresh-456',
  clearSession: mockClearSession,
};

jest.mock('@/stores/auth-store', () => ({
  useAuthStore: jest.fn(),
}));

function renderWithQueryClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

describe('ProfileScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useAuthStore as unknown as jest.Mock).mockImplementation((selector) =>
      selector(baseState),
    );
    (logout as jest.Mock).mockResolvedValue(undefined);
    (listMyBooks as jest.Mock).mockResolvedValue({ items: [], next_cursor: null });
    (getMe as jest.Mock).mockResolvedValue({
      id: '1',
      name: 'Test User',
      email: 'test@example.com',
      trusted_contact_name: null,
      trusted_contact_phone: null,
    });
    (updateMe as jest.Mock).mockResolvedValue({
      id: '1',
      name: 'Test User',
      email: 'test@example.com',
      trusted_contact_name: 'Ali Veli',
      trusted_contact_phone: '0555 555 55 55',
    });
  });

  it('shows user name and email', () => {
    const { getByText } = renderWithQueryClient(<ProfileScreen />);

    expect(getByText('Test User')).toBeTruthy();
    expect(getByText('test@example.com')).toBeTruthy();
  });

  it('logout calls logout, clearTokens, clearSession, and navigates to /auth/login', async () => {
    const { router } = jest.requireMock('expo-router');
    const { getByTestId } = renderWithQueryClient(<ProfileScreen />);

    fireEvent.press(getByTestId('logout-button'));

    await waitFor(() => {
      expect(logout).toHaveBeenCalledWith({ refresh_token: 'refresh-456' });
    });
    expect(clearTokens).toHaveBeenCalled();
    expect(mockClearSession).toHaveBeenCalled();
    expect(router.replace).toHaveBeenCalledWith('/auth/login');
  });

  it('still clears session locally if logout request fails', async () => {
    (logout as jest.Mock).mockRejectedValue(new Error('network error'));
    const { router } = jest.requireMock('expo-router');
    const { getByTestId } = renderWithQueryClient(<ProfileScreen />);

    fireEvent.press(getByTestId('logout-button'));

    await waitFor(() => {
      expect(clearTokens).toHaveBeenCalled();
    });
    expect(mockClearSession).toHaveBeenCalled();
    expect(router.replace).toHaveBeenCalledWith('/auth/login');
  });

  it('shows empty books message', async () => {
    const { findByText } = renderWithQueryClient(<ProfileScreen />);

    expect(await findByText('Henüz kitap eklenmedi')).toBeTruthy();
  });

  it('shows stats badges', async () => {
    const { findByText } = renderWithQueryClient(<ProfileScreen />);

    expect(await findByText('0 takas')).toBeTruthy();
    expect(await findByText('0 kitap')).toBeTruthy();
  });

  it('shows my books and navigates to detail on press', async () => {
    (listMyBooks as jest.Mock).mockResolvedValue({
      items: [
        {
          id: 'book-1',
          title: 'Suç ve Ceza',
          author: 'Dostoyevski',
          category: 'fiction',
          language: 'tr',
          condition: 'good',
          is_available: true,
          public_location: { lat: 41.01, lng: 28.98 },
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        },
      ],
      next_cursor: null,
    });
    const { router } = jest.requireMock('expo-router');
    const { findByTestId } = renderWithQueryClient(<ProfileScreen />);

    const row = await findByTestId('book-row-book-1');
    fireEvent.press(row);

    expect(router.push).toHaveBeenCalledWith('/book/book-1');
  });

  it('navigates to book/new when add-book button is pressed', async () => {
    const { router } = jest.requireMock('expo-router');
    const { findByTestId } = renderWithQueryClient(<ProfileScreen />);

    fireEvent.press(await findByTestId('add-book-button'));

    expect(router.push).toHaveBeenCalledWith('/book/new');
  });
});
