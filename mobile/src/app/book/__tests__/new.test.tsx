import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { ApiError, createBook, uploadBookPhoto } from '@/lib/api/client';
import { useBookDraftStore } from '@/stores/book-draft-store';

import NewBookScreen from '../new';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({}),
}));

jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
  requestMediaLibraryPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
  launchCameraAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn().mockResolvedValue({
    canceled: false,
    assets: [{ uri: 'file:///cover.jpg', mimeType: 'image/jpeg' }],
  }),
}));

jest.mock('@/lib/map-adapter', () => {
  const ReactActual = require('react');
  const { View } = require('react-native');
  const MockMapView = ({ children, onPress, testID }: any) =>
    ReactActual.createElement(View, { testID, onPress }, children);
  const MockMarker = ({ testID }: any) => ReactActual.createElement(View, { testID });
  return {
    __esModule: true,
    MapView: MockMapView,
    Marker: MockMarker,
  };
});

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
  uploadBookPhoto: jest.fn(),
}));

function renderWithQueryClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

/**
 * Drives the real PhotoPicker "Ekle" button: the source sheet (Alert) is
 * answered with "Galeri", which calls the mocked expo-image-picker.
 */
async function addPhoto(getByText: (text: string) => any) {
  jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
    buttons?.find((button) => button.text === 'Galeri')?.onPress?.();
  });
  await act(async () => {
    fireEvent.press(getByText('Ekle'));
  });
}

describe('NewBookScreen (step wizard)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useBookDraftStore.setState({ pickedLocation: null });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('requires a photo before leaving the first step', async () => {
    const { getByTestId, getByText, queryByPlaceholderText } = renderWithQueryClient(
      <NewBookScreen />,
    );

    expect(getByTestId('next-button').props.accessibilityState.disabled).toBe(true);

    await addPhoto(getByText);

    expect(getByTestId('next-button').props.accessibilityState.disabled).toBe(false);
    fireEvent.press(getByTestId('next-button'));

    // Step 2 (book info) is now visible.
    expect(queryByPlaceholderText('Kitabın adı')).toBeTruthy();
  });

  it('requires a title before leaving the book step', async () => {
    const { getByTestId, getByText, getByPlaceholderText } = renderWithQueryClient(
      <NewBookScreen />,
    );

    await addPhoto(getByText);
    fireEvent.press(getByTestId('next-button'));

    expect(getByTestId('next-button').props.accessibilityState.disabled).toBe(true);

    fireEvent.changeText(getByPlaceholderText('Kitabın adı'), 'Suç ve Ceza');

    expect(getByTestId('next-button').props.accessibilityState.disabled).toBe(false);
  });

  it('selects a different category chip and submits it', async () => {
    (createBook as jest.Mock).mockResolvedValue({ id: 'book-1' });
    useBookDraftStore.setState({ pickedLocation: { lat: 41.01, lng: 28.98 } });

    const { getByTestId, getByText, getByPlaceholderText } = renderWithQueryClient(
      <NewBookScreen />,
    );

    await addPhoto(getByText);
    fireEvent.press(getByTestId('next-button'));
    fireEvent.changeText(getByPlaceholderText('Kitabın adı'), 'Suç ve Ceza');
    fireEvent.press(getByTestId('next-button'));

    fireEvent.press(getByTestId('category-textbook'));
    fireEvent.press(getByTestId('next-button'));

    fireEvent.press(getByTestId('submit-book-button'));

    await waitFor(() => {
      expect(createBook).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Suç ve Ceza',
          category: 'textbook',
          language: 'tr',
          condition: 'good',
          location: { lat: 41.01, lng: 28.98 },
        }),
      );
    });
  });

  it('disables submit until a location is set', async () => {
    const { getByTestId, getByText, getByPlaceholderText } = renderWithQueryClient(
      <NewBookScreen />,
    );

    await addPhoto(getByText);
    fireEvent.press(getByTestId('next-button'));
    fireEvent.changeText(getByPlaceholderText('Kitabın adı'), 'Suç ve Ceza');
    fireEvent.press(getByTestId('next-button'));
    fireEvent.press(getByTestId('next-button'));

    expect(getByTestId('submit-book-button').props.accessibilityState.disabled).toBe(true);

    fireEvent.press(getByTestId('submit-book-button'));

    expect(createBook).not.toHaveBeenCalled();
  });

  it('enables submit once a location is picked and title is filled, then creates the book', async () => {
    (createBook as jest.Mock).mockResolvedValue({ id: 'book-1' });
    (uploadBookPhoto as jest.Mock).mockResolvedValue(undefined);
    const { router } = jest.requireMock('expo-router');

    useBookDraftStore.setState({ pickedLocation: { lat: 41.01, lng: 28.98 } });

    const { getByTestId, getByText, getByPlaceholderText } = renderWithQueryClient(
      <NewBookScreen />,
    );

    await addPhoto(getByText);
    fireEvent.press(getByTestId('next-button'));
    fireEvent.changeText(getByPlaceholderText('Kitabın adı'), 'Suç ve Ceza');
    fireEvent.press(getByTestId('next-button'));
    fireEvent.press(getByTestId('next-button'));

    expect(getByTestId('submit-book-button').props.accessibilityState.disabled).toBe(false);

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
    expect(uploadBookPhoto).toHaveBeenCalledWith('book-1', 'file:///cover.jpg', 'image/jpeg');
    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith('/book/book-1');
    });
  });

  it('shows an error when the location is outside Turkey', async () => {
    (createBook as jest.Mock).mockRejectedValue(new ApiError(400, {}));
    (uploadBookPhoto as jest.Mock).mockResolvedValue(undefined);

    useBookDraftStore.setState({ pickedLocation: { lat: 0, lng: 0 } });

    const { getByTestId, getByText, getByPlaceholderText, findByText } =
      renderWithQueryClient(<NewBookScreen />);

    await addPhoto(getByText);
    fireEvent.press(getByTestId('next-button'));
    fireEvent.changeText(getByPlaceholderText('Kitabın adı'), 'Test Kitap');
    fireEvent.press(getByTestId('next-button'));
    fireEvent.press(getByTestId('next-button'));

    fireEvent.press(getByTestId('submit-book-button'));

    expect(await findByText('Seçilen konum Türkiye sınırları dışında.')).toBeTruthy();
  });
});
