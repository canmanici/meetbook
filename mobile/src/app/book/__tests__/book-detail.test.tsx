import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { deleteBook, getBook, updateBook } from '@/lib/api/client';
import { useBookDraftStore } from '@/stores/book-draft-store';

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
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

function renderWithQueryClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

describe('BookDetailScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useBookDraftStore.setState({ pickedLocation: null });
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
      expect(deleteBook).toHaveBeenCalledWith('book-1');
    });
    expect(router.back).toHaveBeenCalled();
  });
});
