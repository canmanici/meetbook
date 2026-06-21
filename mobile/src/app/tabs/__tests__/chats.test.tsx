import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { listChats } from '@/lib/api/chat';

import ChatsScreen from '../chats';

// expo-router: hook-based, unlike requests.tsx which imports `router` directly.
jest.mock('expo-router', () => {
  const push = jest.fn();
  return {
    useRouter: () => ({ push }),
    useFocusEffect: (cb: () => (() => void) | undefined) => cb(),
    __push: push,
  };
});

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('@/lib/api/chat', () => ({
  listChats: jest.fn(),
}));

// Minimal zustand store stand-ins: invoke the selector with a fake state.
jest.mock('@/stores/chat-store', () => {
  const state = {
    connected: true,
    connect: jest.fn(),
    disconnect: jest.fn(),
    typing: {} as Record<string, Record<string, boolean>>,
    presence: {} as Record<string, { is_online: boolean; last_seen: string | null }>,
  };
  return {
    useChatStore: (sel: (s: typeof state) => unknown) => sel(state),
    __setChatState: (patch: Partial<typeof state>) => Object.assign(state, patch),
  };
});

jest.mock('@/stores/auth-store', () => ({
  useAuthStore: (sel: (s: { user: { id: string } | null }) => unknown) =>
    sel({ user: { id: 'me' } }),
}));

function renderWithQueryClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

const now = Date.now();
const sampleChats = [
  {
    chat_id: 'chat-1',
    exchange_id: 'exchange-1',
    counterpart_id: 'user-2',
    counterpart_name: 'Ayşe Yılmaz',
    last_message: 'Merhaba, kitap müsait mi?',
    last_message_type: 'text',
    last_message_at: new Date(now).toISOString(),
    unread_count: 2,
  },
  {
    chat_id: 'chat-2',
    exchange_id: 'exchange-2',
    counterpart_id: 'user-3',
    counterpart_name: 'Mehmet Demir',
    last_message: null,
    last_message_type: 'image',
    last_message_at: new Date(now - 86400000 * 3).toISOString(),
    unread_count: 0,
  },
];

describe('ChatsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (listChats as jest.Mock).mockResolvedValue({ items: [] });
  });

  it('shows skeleton loaders on first render', () => {
    (listChats as jest.Mock).mockReturnValue(new Promise(() => {})); // never resolves
    const { getAllByTestId } = renderWithQueryClient(<ChatsScreen />);

    expect(getAllByTestId('chat-skeleton').length).toBe(5);
  });

  it('shows empty state and navigates to home on action', async () => {
    const { __push } = jest.requireMock('expo-router');
    const { findByText } = renderWithQueryClient(<ChatsScreen />);

    expect(await findByText('Henüz Sohbet Yok')).toBeTruthy();

    fireEvent.press(await findByText('Kitaplara Göz At'));
    expect(__push).toHaveBeenCalledWith('/tabs/home');
  });

  it('renders chat rows grouped by date and navigates on press', async () => {
    (listChats as jest.Mock).mockResolvedValue({ items: sampleChats });
    const { __push } = jest.requireMock('expo-router');
    const { findByText, findByTestId } = renderWithQueryClient(<ChatsScreen />);

    // Section headers appear.
    expect(await findByText('Bugün')).toBeTruthy();
    expect(await findByText('Bu Hafta')).toBeTruthy();

    // Row content.
    expect(await findByText('Ayşe Yılmaz')).toBeTruthy();
    expect(await findByText('Mehmet Demir')).toBeTruthy();

    // Image-type fallback preview (last_message null + type image).
    expect(await findByText('Fotoğraf')).toBeTruthy();

    fireEvent.press(await findByTestId('chat-row-exchange-1'));
    expect(__push).toHaveBeenCalledWith('/chat/exchange-1');
  });

  it('filters rows by search query', async () => {
    (listChats as jest.Mock).mockResolvedValue({ items: sampleChats });
    const { findByTestId, findByText, queryByText } = renderWithQueryClient(<ChatsScreen />);

    await findByText('Ayşe Yılmaz');

    fireEvent.changeText(await findByTestId('chat-search-input'), 'Ayşe');

    await waitFor(() => {
      expect(findByText('Ayşe Yılmaz')).toBeTruthy();
      expect(queryByText('Mehmet Demir')).toBeNull();
    });
  });

  it('shows only unread chats when unread filter is active', async () => {
    (listChats as jest.Mock).mockResolvedValue({ items: sampleChats });
    const { findByTestId, findByText, queryByText } = renderWithQueryClient(<ChatsScreen />);

    await findByText('Ayşe Yılmaz'); // wait for data

    fireEvent.press(await findByTestId('filter-unread'));

    await waitFor(() => {
      expect(findByText('Ayşe Yılmaz')).toBeTruthy();
      expect(queryByText('Mehmet Demir')).toBeNull();
    });
  });
});
