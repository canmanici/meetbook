import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

import { login } from '@/lib/api/client';
import { setTokens } from '@/lib/secure-store';
import { useAuthStore } from '@/stores/auth-store';

import LoginScreen from '../login';

jest.mock('expo-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => children,
  router: { replace: jest.fn() },
}));

jest.mock('@/lib/api/client', () => {
  class ApiError extends Error {
    status: number;
    constructor(status: number) {
      super('api error');
      this.status = status;
    }
  }
  return { login: jest.fn(), ApiError };
});

jest.mock('@/lib/secure-store', () => ({
  setTokens: jest.fn(),
}));

const initialState = useAuthStore.getState();

describe('LoginScreen', () => {
  beforeEach(() => {
    useAuthStore.setState(initialState, true);
    jest.clearAllMocks();
  });

  it('renders email and password inputs and a submit button', () => {
    const { getAllByTestId, getByText } = render(<LoginScreen />);
    expect(getAllByTestId('input-field')).toHaveLength(2);
    expect(getByText('Giriş yap')).toBeTruthy();
  });

  it('logs in successfully and sets the session', async () => {
    (login as jest.Mock).mockResolvedValue({
      access_token: 'a1',
      refresh_token: 'r1',
      user: { id: 'u1', email: 'a@example.com', name: 'A' },
    });

    const { getAllByTestId, getByTestId } = render(<LoginScreen />);
    const inputs = getAllByTestId('input-field');
    fireEvent.changeText(inputs[0], 'a@example.com');
    fireEvent.changeText(inputs[1], 'password123');
    fireEvent.press(getByTestId('button'));

    await waitFor(() => {
      expect(setTokens).toHaveBeenCalledWith('a1', 'r1');
    });
    expect(useAuthStore.getState().status).toBe('authenticated');
    expect(useAuthStore.getState().user).toEqual({ id: 'u1', email: 'a@example.com', name: 'A' });
  });

  it('shows an inline error on 401', async () => {
    const { ApiError } = jest.requireMock('@/lib/api/client');
    (login as jest.Mock).mockRejectedValue(new ApiError(401));

    const { getAllByTestId, getByTestId, getByText } = render(<LoginScreen />);
    const inputs = getAllByTestId('input-field');
    fireEvent.changeText(inputs[0], 'a@example.com');
    fireEvent.changeText(inputs[1], 'wrongpass');
    fireEvent.press(getByTestId('button'));

    await waitFor(() => {
      expect(getByText('E-posta/kullanıcı adı veya şifre hatalı.')).toBeTruthy();
    });
  });

  const renderLogin = () => render(<LoginScreen />);

  it('wraps the form in a KeyboardAvoidingView', () => {
    // KeyboardAvoidingView is a View subclass; we assert it exists in the tree
    const { getByTestId } = renderLogin();
    expect(getByTestId('auth-keyboard-view')).toBeTruthy();
  });
});
