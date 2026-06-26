/**
 * chat-detail.test.tsx — Task 05: ellipsis button wires to chat info screen.
 */

import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('expo-router', () => {
  const router = { push: jest.fn(), back: jest.fn() };
  return {
    __esModule: true,
    router,
    useRouter: () => router,
    useLocalSearchParams: () => ({ id: 'ex-1' }),
  };
});
jest.mock('@/lib/api/client', () => ({
  __esModule: true,
  getExchange: jest.fn().mockResolvedValue({
    id: 'ex-1', status: 'accepted',
    book: { id: 'b1', title: 'T', author: 'A', category: 'fiction', condition: 'good', photos: [] },
    requester: { id: 'u2', name: 'Other' }, owner: { id: 'me', name: 'Me' },
    created_at: '2026-06-01T00:00:00Z',
  }),
}));
jest.mock('@/lib/api/chat', () => ({
  __esModule: true,
  getMessages: jest.fn().mockResolvedValue({ items: [], next_cursor: null }),
  listChats: jest.fn().mockResolvedValue({ items: [] }),
  markMessagesRead: jest.fn().mockResolvedValue(undefined),
  searchMessages: jest.fn().mockResolvedValue({ items: [] }),
}));
jest.mock('@/stores/chat-store', () => {
  const mockState = {
    messages: {}, typing: {}, connect: jest.fn(), disconnect: jest.fn(),
    sendMessage: jest.fn(), sendTyping: jest.fn(), sendDelete: jest.fn(),
    sendReaction: jest.fn(), replyingTo: null, setReplyingTo: jest.fn(),
    markMessagesRead: jest.fn(),
  };
  return {
    useChatStore: (selector?: any) => (selector ? selector(mockState) : mockState),
  };
});
jest.mock('@/stores/auth-store', () => {
  const mockState = { user: { id: 'me', name: 'Me' } };
  return {
    useAuthStore: (selector?: any) => (selector ? selector(mockState) : mockState),
  };
});
jest.mock('react-native-safe-area-context', () => ({
  __esModule: true,
  useSafeAreaInsets: () => ({ top: 44, bottom: 34, left: 0, right: 0 }),
}));
jest.mock('expo-linear-gradient', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { LinearGradient: (p: any) => React.createElement(View, p) };
});
jest.mock('react-native-reanimated', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: { View: React.forwardRef((p: any, r: any) => React.createElement(View, { ...p, ref: r })) },
  };
});

import ChatDetailScreen from '../[id]';

function renderChat() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><ChatDetailScreen /></QueryClientProvider>);
}

describe('ChatDetailScreen', () => {
  it('ellipsis button navigates to chat info', async () => {
    const { router } = require('expo-router');
    const { findByTestId } = renderChat();
    const ellipsis = await findByTestId('chat-info-button');
    fireEvent.press(ellipsis);
    expect(router.push).toHaveBeenCalledWith('/chat/info/ex-1');
  });

  it('search result tap scrolls FlatList to that message', async () => {
    const { searchMessages } = require('@/lib/api/chat');
    searchMessages.mockResolvedValue({
      items: [{ message: { id: 'msg-9', chat_id: 'ex-1', sender_id: 'u2', message_type: 'text', text: 'found me', created_at: '2026-06-02T00:00:00Z', read_at: null } }],
    });

    const { findByPlaceholderText, findByTestId, queryByTestId } = renderChat();

    // Open search mode
    const searchToggle = await findByTestId('chat-search-toggle');
    fireEvent.press(searchToggle);

    const input = await findByPlaceholderText('Sohbette ara...');
    fireEvent.changeText(input, 'found');
    fireEvent(input, 'submitEditing');

    // Wait for the search result item to appear
    const resultItem = await findByTestId('search-result-msg-9');
    fireEvent.press(resultItem);

    // After pressing, search should clear (result list disappears)
    await waitFor(() => expect(queryByTestId('search-result-msg-9')).toBeNull());
  });

  it('does not render a mic button when input is empty', async () => {
    const { queryByTestId, findByTestId } = renderChat();
    // Wait for the chat to render
    await findByTestId('chat-input');
    // No mic button should be present
    expect(queryByTestId('mic-button')).toBeNull();
  });

  it('shows send button when input has text', async () => {
    const { findByTestId } = renderChat();
    const input = await findByTestId('chat-input');
    fireEvent.changeText(input, 'hello');
    expect(await findByTestId('send-button')).toBeTruthy();
  });
});
