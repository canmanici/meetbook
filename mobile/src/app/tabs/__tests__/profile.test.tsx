import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

import { logout } from '@/lib/api/client';
import { clearTokens } from '@/lib/secure-store';
import { useAuthStore } from '@/stores/auth-store';

import ProfileScreen from '../profile';

jest.mock('expo-router', () => ({
  router: { replace: jest.fn() },
}));

jest.mock('@/lib/api/client', () => ({
  logout: jest.fn(),
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

describe('ProfileScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useAuthStore as unknown as jest.Mock).mockImplementation((selector) =>
      selector(baseState),
    );
    (logout as jest.Mock).mockResolvedValue(undefined);
  });

  it('shows user name and email', () => {
    const { getByText } = render(<ProfileScreen />);

    expect(getByText('Test User')).toBeTruthy();
    expect(getByText('test@example.com')).toBeTruthy();
  });

  it('logout calls logout, clearTokens, clearSession, and navigates to /auth/login', async () => {
    const { router } = jest.requireMock('expo-router');
    const { getByTestId } = render(<ProfileScreen />);

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
    const { getByTestId } = render(<ProfileScreen />);

    fireEvent.press(getByTestId('logout-button'));

    await waitFor(() => {
      expect(clearTokens).toHaveBeenCalled();
    });
    expect(mockClearSession).toHaveBeenCalled();
    expect(router.replace).toHaveBeenCalledWith('/auth/login');
  });
});
