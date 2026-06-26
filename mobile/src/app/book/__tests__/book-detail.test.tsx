import React from 'react';
import { Alert, Share } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/components/ui/toast-provider';

import { deleteBook, getBook, updateBook } from '@/lib/api/client';
import { useBookDraftStore } from '@/stores/book-draft-store';
import { useAuthStore } from '@/stores/auth-store';

import BookDetailScreen from '../[id]';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({ id: 'book-1' }),
}));

jest.mock('@/lib/api/client', () => ({
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number) {
      super('error');
      this.status = status;
    }
  },
  getBook: jest.fn(),
  updateBook: jest.fn(),
  deleteBook: jest.fn(),
  incrementBookView: jest.fn().mockResolvedValue(undefined),
  addFavorite: jest.fn().mockResolvedValue(undefined),
  removeFavorite: jest.fn().mockResolvedValue(undefined),
}));

const OWNER_BOOK = {
  id: 'book-1',
  owner_id: 'user-1',
  title: 'Suç ve Ceza',
  author: 'Dostoyevski',
  isbn: null,
  description: null,
  category: 'fiction' as const,
  language: 'tr',
  condition: 'good' as const,
  is_available: true,
  location: { lat: 41.0082, lng: 28.9784 },
  public_location: { lat: 41.01, lng: 28.98 },
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const PUBLIC_BOOK = {
  id: 'book-2',
  owner_id: 'user-2',
  title: 'Beyaz Diş',
  author: 'Jack London',
  isbn: null,
  description: null,
  category: 'fiction' as const,
  language: 'en',
  condition: 'worn' as const,
  is_available: false,
  public_location: { lat: 39.93, lng: 32.86 },
  distance_km: 3.7,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

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

describe('BookDetailScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useBookDraftStore.setState({ pickedLocation: null });
    useAuthStore.setState({ user: { id: 'user-1', name: 'Me', email: 'me@example.com' } as any });
  });

  it('shows edit and delete actions for the owner', async () => {
    (getBook as jest.Mock).mockResolvedValue(OWNER_BOOK);

    const { findByText, getByTestId } = renderWithQueryClient(<BookDetailScreen />);

    expect(await findByText('Suç ve Ceza')).toBeTruthy();
    expect(getByTestId('edit-book-button')).toBeTruthy();
    expect(getByTestId('delete-book-button')).toBeTruthy();
  });

  it('hides edit and delete actions for non-owners', async () => {
    (getBook as jest.Mock).mockResolvedValue(PUBLIC_BOOK);

    const { findByText, queryByTestId } = renderWithQueryClient(<BookDetailScreen />);

    expect(await findByText('Beyaz Diş')).toBeTruthy();
    expect(queryByTestId('edit-book-button')).toBeNull();
    expect(queryByTestId('delete-book-button')).toBeNull();
  });

  it('shows a not-found message when the book cannot be loaded', async () => {
    (getBook as jest.Mock).mockRejectedValue(new Error('not found'));

    const { findByText } = renderWithQueryClient(<BookDetailScreen />);

    expect(await findByText('Kitap bulunamadı.')).toBeTruthy();
  });

  it('lets the owner edit and save the book', async () => {
    (getBook as jest.Mock).mockResolvedValue(OWNER_BOOK);
    (updateBook as jest.Mock).mockResolvedValue({ ...OWNER_BOOK, title: 'Yeni Başlık' });

    const { findByText, getByTestId, getByDisplayValue } = renderWithQueryClient(<BookDetailScreen />);

    await findByText('Suç ve Ceza');
    fireEvent.press(getByTestId('edit-book-button'));

    const titleInput = await waitFor(() => getByDisplayValue('Suç ve Ceza'));
    fireEvent.changeText(titleInput, 'Yeni Başlık');

    fireEvent.press(getByTestId('save-book-button'));

    await waitFor(() => {
      expect(updateBook).toHaveBeenCalledWith(
        'book-1',
        expect.objectContaining({ title: 'Yeni Başlık', location: { lat: 41.0082, lng: 28.9784 } }),
      );
    });
  });

  it('deletes the book after confirmation', async () => {
    (getBook as jest.Mock).mockResolvedValue(OWNER_BOOK);
    (deleteBook as jest.Mock).mockResolvedValue(undefined);
    const { router } = jest.requireMock('expo-router');

    jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      const confirm = buttons?.find((b) => b.text === 'Sil');
      confirm?.onPress?.(undefined as never);
    });

    const { findByText, getByTestId } = renderWithQueryClient(<BookDetailScreen />);

    await findByText('Suç ve Ceza');
    fireEvent.press(getByTestId('delete-book-button'));

    await waitFor(() => {
      expect(deleteBook).toHaveBeenCalledWith('book-1', undefined);
    });
    expect(router.back).toHaveBeenCalled();
  });

  it('shows force delete popup and retries with force=true on 409', async () => {
    (getBook as jest.Mock).mockResolvedValue(OWNER_BOOK);
    const apiError = new (jest.requireMock('@/lib/api/client').ApiError)(409);
    const deleteMock = deleteBook as jest.Mock;
    // First call without force fails, second call with force=true succeeds
    deleteMock.mockRejectedValueOnce(apiError).mockResolvedValueOnce(undefined);
    const { router } = jest.requireMock('expo-router');

    let alertCall = 0;
    jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      alertCall++;
      if (alertCall === 1) {
        // First alert: delete confirmation, press "Sil"
        const confirm = buttons?.find((b) => b.text === 'Sil');
        confirm?.onPress?.(undefined as never);
      } else if (alertCall === 2) {
        // Second alert: force delete confirmation, press "Zorla Sil"
        const forceDelete = buttons?.find((b) => b.text === 'Zorla Sil');
        forceDelete?.onPress?.(undefined as never);
      }
    });

    const { findByText, getByTestId } = renderWithQueryClient(<BookDetailScreen />);

    await findByText('Suç ve Ceza');
    fireEvent.press(getByTestId('delete-book-button'));

    await waitFor(() => {
      expect(deleteBook).toHaveBeenCalledWith('book-1', undefined);
    });
    await waitFor(() => {
      expect(deleteBook).toHaveBeenCalledWith('book-1', true);
    });
    expect(router.back).toHaveBeenCalled();
  });

  it('shows generic error when force delete also fails', async () => {
    (getBook as jest.Mock).mockResolvedValue(OWNER_BOOK);
    const apiError = new (jest.requireMock('@/lib/api/client').ApiError)(409);
    const deleteMock = deleteBook as jest.Mock;
    // Both calls fail
    deleteMock.mockRejectedValue(apiError);
    const { router } = jest.requireMock('expo-router');

    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      // The first alert is always the delete confirmation
      if (buttons?.find((b) => b.text === 'Sil') && !buttons?.find((b) => b.text === 'Zorla Sil')) {
        const confirm = buttons.find((b) => b.text === 'Sil');
        confirm?.onPress?.(undefined as never);
      }
      // The second alert has "Zorla Sil" — press it
      const forceDelete = buttons?.find((b) => b.text === 'Zorla Sil');
      forceDelete?.onPress?.(undefined as never);
    });

    const { findByText, getByTestId } = renderWithQueryClient(<BookDetailScreen />);

    await findByText('Suç ve Ceza');
    fireEvent.press(getByTestId('delete-book-button'));

    await waitFor(() => {
      expect(deleteBook).toHaveBeenCalledWith('book-1', undefined);
    });
    await waitFor(() => {
      expect(deleteBook).toHaveBeenCalledWith('book-1', true);
    });

    // Should show the generic error alert (not the force delete popup)
    expect(alertSpy).toHaveBeenLastCalledWith(
      'Hata',
      'Kitap silinirken bir hata oluştu. Lütfen tekrar deneyin.',
    );
    expect(router.back).not.toHaveBeenCalled();
  });

  it('share button calls Share.share with book title and author', async () => {
    jest.clearAllMocks();
    const { Share } = require('react-native');
    Share.share = jest.fn().mockResolvedValue({ action: 'shared' });

    const { getBook } = require('@/lib/api/client');
    getBook.mockResolvedValue(PUBLIC_BOOK);
    useAuthStore.setState({ user: { id: 'user-1', name: 'Me', email: 'me@example.com' } as any });

    const { findByTestId } = renderWithQueryClient(<BookDetailScreen />);
    // Wait for book to load (non-owner of PUBLIC_BOOK which has owner_id 'user-2')
    const shareBtn = await findByTestId('share-button');
    await waitFor(() => expect(shareBtn.props.disabled).toBeFalsy());

    fireEvent.press(shareBtn);

    await waitFor(() => expect(Share.share).toHaveBeenCalled());
    const callArg = Share.share.mock.calls[0][0];
    expect(callArg.message).toContain('Beyaz Diş');
    expect(callArg.message).toContain('Jack London');
  });

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

  it('shows skeleton cards while loading (not a bare spinner)', async () => {
    jest.clearAllMocks();
    const { getBook } = require('@/lib/api/client');
    // Never resolves → stays in loading state
    getBook.mockReturnValue(new Promise(() => {}));
    useAuthStore.setState({ user: { id: 'user-1', name: 'Me', email: 'me@example.com' } as any });

    const { findAllByTestId, queryByTestId } = renderWithQueryClient(<BookDetailScreen />);
    expect((await findAllByTestId('skeleton-card')).length).toBeGreaterThanOrEqual(1);
    expect(queryByTestId('loading-spinner')).toBeNull();
  });
});
