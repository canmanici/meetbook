import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

import { register } from '@/lib/api/client';
import { setTokens } from '@/lib/secure-store';
import { useAuthStore } from '@/stores/auth-store';

import RegisterScreen from '../register';

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
  return { register: jest.fn(), ApiError };
});

jest.mock('@/lib/secure-store', () => ({
  setTokens: jest.fn(),
}));

const initialState = useAuthStore.getState();

describe('RegisterScreen', () => {
  beforeEach(() => {
    useAuthStore.setState(initialState, true);
    jest.clearAllMocks();
  });

  it('disables submit until the KVKK consent toggle is checked', () => {
    const { getAllByTestId, getByTestId, getByText } = render(<RegisterScreen />);
    const inputs = getAllByTestId('input-field');
    fireEvent.changeText(inputs[0], 'Test User');
    fireEvent.changeText(inputs[1], 'a@example.com');
    fireEvent.changeText(inputs[2], 'password123');

    fireEvent.press(getByTestId('button'));
    expect(register).not.toHaveBeenCalled();

    fireEvent.press(getByTestId('kvkk-consent-toggle'));
    fireEvent.press(getByText('Kayıt ol'));
    expect(register).toHaveBeenCalled();
  });

  it('registers successfully and sets the session', async () => {
    (register as jest.Mock).mockResolvedValue({
      user_id: 'u1',
      access_token: 'a1',
      refresh_token: 'r1',
      user: { id: 'u1', email: 'a@example.com', name: 'Test User' },
    });

    const { getAllByTestId, getByTestId, getByText } = render(<RegisterScreen />);
    const inputs = getAllByTestId('input-field');
    fireEvent.changeText(inputs[0], 'Test User');
    fireEvent.changeText(inputs[1], 'a@example.com');
    fireEvent.changeText(inputs[2], 'password123');
    fireEvent.press(getByTestId('kvkk-consent-toggle'));
    fireEvent.press(getByText('Kayıt ol'));

    await waitFor(() => {
      expect(setTokens).toHaveBeenCalledWith('a1', 'r1');
    });
    expect(useAuthStore.getState().status).toBe('authenticated');
    expect(register).toHaveBeenCalledWith({
      email: 'a@example.com',
      password: 'password123',
      name: 'Test User',
      kvkk_consent: true,
    });
  });

  it('shows an inline error on 409', async () => {
    const { ApiError } = jest.requireMock('@/lib/api/client');
    (register as jest.Mock).mockRejectedValue(new ApiError(409));

    const { getAllByTestId, getByTestId, getByText } = render(<RegisterScreen />);
    const inputs = getAllByTestId('input-field');
    fireEvent.changeText(inputs[0], 'Test User');
    fireEvent.changeText(inputs[1], 'dup@example.com');
    fireEvent.changeText(inputs[2], 'password123');
    fireEvent.press(getByTestId('kvkk-consent-toggle'));
    fireEvent.press(getByText('Kayıt ol'));

    await waitFor(() => {
      expect(getByText('Bu e-posta zaten kayıtlı.')).toBeTruthy();
    });
  });

  const renderRegister = () => render(<RegisterScreen />);

  it('wraps the form in a KeyboardAvoidingView', () => {
    const { getByTestId } = renderRegister();
    expect(getByTestId('auth-keyboard-view')).toBeTruthy();
  });
});
