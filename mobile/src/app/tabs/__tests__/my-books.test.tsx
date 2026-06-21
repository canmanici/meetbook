import React, { act } from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { router } from 'expo-router';

import { listMyBooks, deleteBook, updateBook } from '@/lib/api/client';
import { ToastProvider } from '@/components/ui/toast-provider';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn() },
}));

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(),
  notificationAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: 'L', Medium: 'M', Heavy: 'H' },
  NotificationFeedbackType: { Warning: 'W', Success: 'S', Error: 'E' },
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('expo-linear-gradient', () => ({
  LinearGradient: ({ children }: any) => children ?? null,
}));

jest.mock('@/lib/qr', () => ({
  QRCodeView: () => null,
  bookDeepLink: (id: string) => `https://meetbook.app/book/${id}`,
}));

jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn().mockResolvedValue(true),
  shareAsync: jest.fn(),
}));

jest.mock('@/lib/api/client', () => ({
  listMyBooks: jest.fn(),
  deleteBook: jest.fn(),
  updateBook: jest.fn(),
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

const mockBooks = {
  items: [
    {
      id: '1',
      owner_id: 'me',
      owner_name: 'Test',
      title: 'Suç ve Ceza',
      author: 'Dostoyevski',
      isbn: '123',
      description: 'Raskolnikov...',
      category: 'fiction',
      language: 'tr',
      condition: 'good',
      is_available: true,
      photos: [{ id: 'p1', url: 'https://example.com/cover1.jpg', position: 0 }],
      view_count: 12,
      favorite_count: 3,
      created_at: new Date(Date.now() - 2 * 86400000).toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: '2',
      owner_id: 'me',
      owner_name: 'Test',
      title: 'Sapiens',
      author: 'Yuval Harari',
      isbn: '456',
      description: 'İnsan türü...',
      category: 'non_fiction',
      language: 'tr',
      condition: 'like_new',
      is_available: true,
      photos: [],
      view_count: 28,
      favorite_count: 7,
      created_at: new Date(Date.now() - 5 * 86400000).toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: '3',
      owner_id: 'me',
      owner_name: 'Test',
      title: 'Tamamlanan Kitap',
      author: 'Yazar',
      isbn: null,
      description: null,
      category: 'fiction',
      language: 'tr',
      condition: 'good',
      is_available: false,
      photos: [],
      view_count: 5,
      favorite_count: 1,
      created_at: new Date(Date.now() - 30 * 86400000).toISOString(),
      updated_at: new Date().toISOString(),
    },
  ],
  next_cursor: null,
};

import MyBooksTab from '../my-books';

describe('MyBooksTab', () => {
  beforeEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
    (listMyBooks as jest.Mock).mockResolvedValue(mockBooks);
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('shows loading skeletons while fetching', () => {
    (listMyBooks as jest.Mock).mockImplementation(() => new Promise(() => {}));
    const { getAllByTestId } = renderWithQueryClient(<MyBooksTab />);
    expect(getAllByTestId(/skeleton/).length).toBeGreaterThanOrEqual(2);
  });

  it('shows empty state with CTA when no active books', async () => {
    (listMyBooks as jest.Mock).mockResolvedValue({ items: [], next_cursor: null });
    const { findByText, findByTestId } = renderWithQueryClient(<MyBooksTab />);
    expect(await findByText('Henüz kitap eklenmedi')).toBeTruthy();
    const cta = await findByTestId('empty-state-action');
    fireEvent.press(cta);
    expect(router.push).toHaveBeenCalledWith('/book/new');
  });

  it('shows completed empty state on takas tab', async () => {
    (listMyBooks as jest.Mock).mockResolvedValue({
      items: [mockBooks.items[0]],
      next_cursor: null,
    });
    const { findByText } = renderWithQueryClient(<MyBooksTab />);
    const takasTab = await findByText(/Takas Edilen/);
    fireEvent.press(takasTab);
    expect(await findByText('Henüz takas edilen kitap yok')).toBeTruthy();
  });

  it('shows error state with retry when API fails', async () => {
    (listMyBooks as jest.Mock).mockRejectedValue(new Error('Network error'));
    const { findByText } = renderWithQueryClient(<MyBooksTab />);
    expect(await findByText('Kitaplar yüklenemedi')).toBeTruthy();
    expect(await findByText('Tekrar dene')).toBeTruthy();
  });

  it('renders book cards with rich fields when books exist', async () => {
    const { findByText } = renderWithQueryClient(<MyBooksTab />);
    expect(await findByText('Suç ve Ceza')).toBeTruthy();
    expect(await findByText('Dostoyevski')).toBeTruthy();
    expect(await findByText('12 görüntülenme · 3 favori')).toBeTruthy();
  });

  it('filters books when tab changes', async () => {
    const { findByText, queryByText } = renderWithQueryClient(<MyBooksTab />);
    expect(await findByText('Suç ve Ceza')).toBeTruthy();
    const takasTab = await findByText(/Takas Edilen/);
    fireEvent.press(takasTab);
    await waitFor(() => {
      expect(queryByText('Suç ve Ceza')).toBeNull();
      expect(queryByText('Tamamlanan Kitap')).toBeTruthy();
    });
  });

  it('filters by search query (title)', async () => {
    const { findByPlaceholderText, findByText, queryByText } = renderWithQueryClient(
      <MyBooksTab />,
    );
    const searchInput = await findByPlaceholderText(/Kitap, yazar veya ISBN ara/);
    fireEvent.changeText(searchInput, 'Suç');
    await waitFor(() => {
      expect(queryByText('Sapiens')).toBeNull();
    });
    expect(await findByText('Suç ve Ceza')).toBeTruthy();
  });

  it('filters by search query (author)', async () => {
    const { findByPlaceholderText, findByText, queryByText } = renderWithQueryClient(
      <MyBooksTab />,
    );
    const searchInput = await findByPlaceholderText(/Kitap, yazar veya ISBN ara/);
    fireEvent.changeText(searchInput, 'Harari');
    await waitFor(() => {
      expect(queryByText('Suç ve Ceza')).toBeNull();
    });
    expect(await findByText('Sapiens')).toBeTruthy();
  });

  it('shows search empty state when query matches no books', async () => {
    const { findByPlaceholderText, findByText } = renderWithQueryClient(<MyBooksTab />);
    const searchInput = await findByPlaceholderText(/Kitap, yazar veya ISBN ara/);
    fireEvent.changeText(searchInput, 'zzzznonono');
    expect(await findByText('Arama için sonuç yok')).toBeTruthy();
  });

  it('opens action sheet on long press', async () => {
    const { findByText } = renderWithQueryClient(<MyBooksTab />);
    const card = await findByText('Suç ve Ceza');
    fireEvent(card, 'onLongPress');
    expect(await findByText('Uygun değil yap')).toBeTruthy();
    expect(await findByText('Düzenle')).toBeTruthy();
    expect(await findByText('Sil')).toBeTruthy();
  });

  it('shows undo toast on delete and restores on undo', async () => {
    jest.useFakeTimers();
    const { findByText, queryByText } = renderWithQueryClient(<MyBooksTab />);
    expect(await findByText('Suç ve Ceza')).toBeTruthy();
    const card = await findByText('Suç ve Ceza');
    fireEvent(card, 'onLongPress');
    const deleteBtn = await findByText('Sil');
    fireEvent.press(deleteBtn);
    expect(await findByText('Geri Al')).toBeTruthy();
    fireEvent.press(await findByText('Geri Al'));
    await waitFor(() => {
      expect(queryByText('Geri Al')).toBeNull();
    });
    expect(await findByText('Suç ve Ceza')).toBeTruthy();
    jest.useRealTimers();
  });

  it('calls delete API after undo window expires', async () => {
    jest.useFakeTimers();
    (deleteBook as jest.Mock).mockResolvedValue(undefined);
    const { findByText, queryByText } = renderWithQueryClient(<MyBooksTab />);
    expect(await findByText('Suç ve Ceza')).toBeTruthy();
    const card = await findByText('Suç ve Ceza');
    fireEvent(card, 'onLongPress');
    fireEvent.press(await findByText('Sil'));
    expect(await findByText('Geri Al')).toBeTruthy();
    await act(async () => {
      jest.advanceTimersByTime(5100);
    });
    await waitFor(() => {
      expect(deleteBook).toHaveBeenCalledWith('1');
    });
    jest.useRealTimers();
  });

  it('opens QR modal from action sheet', async () => {
    const { findByText } = renderWithQueryClient(<MyBooksTab />);
    const card = await findByText('Suç ve Ceza');
    fireEvent(card, 'onLongPress');
    fireEvent.press(await findByText('QR kod'));
    expect(await findByText(/Bu kodu tarayın/)).toBeTruthy();
  });

  it('navigates to edit with ?edit=1 on Düzenle press', async () => {
    const { findByText } = renderWithQueryClient(<MyBooksTab />);
    const card = await findByText('Suç ve Ceza');
    fireEvent(card, 'onLongPress');
    fireEvent.press(await findByText('Düzenle'));
    expect(router.push).toHaveBeenCalledWith('/book/1?edit=1');
  });

  it('switches to grid view when toggle pressed', async () => {
    const { findByText, queryByText, findByLabelText } = renderWithQueryClient(<MyBooksTab />);
    expect(await findByText('Suç ve Ceza')).toBeTruthy();
    const toggleBtn = await findByLabelText('Grid görünüm');
    fireEvent.press(toggleBtn);
    await waitFor(() => {
      expect(queryByText('12 görüntülenme')).toBeNull();
    });
    expect(await findByText('Suç ve Ceza')).toBeTruthy();
  });

  it('FAB navigates to /book/new', async () => {
    const { findByLabelText } = renderWithQueryClient(<MyBooksTab />);
    const fab = await findByLabelText('Yeni kitap ekle');
    fireEvent.press(fab);
    expect(router.push).toHaveBeenCalledWith('/book/new');
  });

  it('header shows total counts', async () => {
    const { findByText } = renderWithQueryClient(<MyBooksTab />);
    expect(await findByText('Kitaplarım')).toBeTruthy();
    expect(await findByText(/3 kitap/)).toBeTruthy();
    expect(await findByText(/2 aktif/)).toBeTruthy();
    expect(await findByText(/1 takasta/)).toBeTruthy();
  });

  it('retries when error button is pressed', async () => {
    (listMyBooks as jest.Mock).mockRejectedValue(new Error('Network error'));
    const { findByText } = renderWithQueryClient(<MyBooksTab />);
    expect(await findByText('Kitaplar yüklenemedi')).toBeTruthy();
    fireEvent.press(await findByText('Tekrar dene'));
    await waitFor(() => {
      expect(listMyBooks).toHaveBeenCalledTimes(2);
    });
  });
});
