/**
 * chat-detail.test.tsx — Task 05: ellipsis button wires to chat info screen.
 */

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
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
});
