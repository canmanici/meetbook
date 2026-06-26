import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn() } }));
jest.mock('@/lib/api/client', () => ({
  listBlockedUsers: jest.fn().mockResolvedValue({
    items: [{ user_id: 'u1', created_at: '2026-01-01T00:00:00Z' }],
  }),
  unblockUser: jest.fn(),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 44, bottom: 34, left: 0, right: 0 }),
}));

import BlockedUsersScreen from '../blocked-users';

function renderBlockedUsers() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><BlockedUsersScreen /></QueryClientProvider>);
}

describe('BlockedUsersScreen pull-to-refresh', () => {
  beforeEach(() => {
    const { listBlockedUsers } = require('@/lib/api/client');
    listBlockedUsers.mockClear();
  });

  it('supports pull-to-refresh', async () => {
    const { listBlockedUsers } = require('@/lib/api/client');
    listBlockedUsers.mockClear();
    const { findByTestId } = renderBlockedUsers();
    await waitFor(() => expect(listBlockedUsers).toHaveBeenCalledTimes(1));
    const scroll = await findByTestId('blocked-scroll');
    scroll.props.refreshControl.props.onRefresh();
    await waitFor(() => expect(listBlockedUsers).toHaveBeenCalledTimes(2));
  });
});
