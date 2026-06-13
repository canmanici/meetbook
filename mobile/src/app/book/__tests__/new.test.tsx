import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { ApiError, createBook } from '@/lib/api/client';
import { useBookDraftStore } from '@/stores/book-draft-store';

import NewBookScreen from '../new';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
}));

jest.mock('@/lib/api/client', () => ({
  ApiError: class ApiError extends Error {
    status: number;
    body: unknown;
    constructor(status: number, body: unknown) {
      super('error');
      this.status = status;
      this.body = body;
    }
  },
  createBook: jest.fn(),
}));

function renderWithQueryClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

describe('NewBookScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useBookDraftStore.setState({ pickedLocation: null });
  });

  it('disables submit until a title and location are set', () => {
    const { getByTestId } = renderWithQueryClient(<NewBookScreen />);

    fireEvent.press(getByTestId('submit-book-button'));

    expect(createBook).not.toHaveBeenCalled();
  });

  it('navigates to the location picker', () => {
    const { router } = jest.requireMock('expo-router');
    const { getByTestId } = renderWithQueryClient(<NewBookScreen />);

    fireEvent.press(getByTestId('pick-location-button'));

    expect(router.push).toHaveBeenCalledWith('/book/location-picker');
  });

  it('enables submit once a location is picked and title is filled, then creates the book', async () => {
    (createBook as jest.Mock).mockResolvedValue({ id: 'book-1' });
    const { router } = jest.requireMock('expo-router');

    useBookDraftStore.setState({ pickedLocation: { lat: 41.01, lng: 28.98 } });

    const { getByTestId, getByPlaceholderText } = renderWithQueryClient(<NewBookScreen />);

    fireEvent.changeText(getByPlaceholderText('Kitabın adı'), 'Suç ve Ceza');

    fireEvent.press(getByTestId('submit-book-button'));

    await waitFor(() => {
      expect(createBook).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Suç ve Ceza',
          category: 'fiction',
          language: 'tr',
          condition: 'good',
          location: { lat: 41.01, lng: 28.98 },
        }),
      );
    });
    expect(router.replace).toHaveBeenCalledWith('/book/book-1');
  });

  it('shows an error when the location is outside Turkey', async () => {
    (createBook as jest.Mock).mockRejectedValue(new ApiError(400, {}));
    useBookDraftStore.setState({ pickedLocation: { lat: 0, lng: 0 } });

    const { getByTestId, getByPlaceholderText, findByText } = renderWithQueryClient(<NewBookScreen />);

    fireEvent.changeText(getByPlaceholderText('Kitabın adı'), 'Test Kitap');

    fireEvent.press(getByTestId('submit-book-button'));

    expect(await findByText('Seçilen konum Türkiye sınırları dışında.')).toBeTruthy();
  });

  it('selects a different category chip', () => {
    const { getByTestId } = renderWithQueryClient(<NewBookScreen />);

    fireEvent.press(getByTestId('category-textbook'));

    expect(getByTestId('category-textbook')).toBeTruthy();
  });
});
