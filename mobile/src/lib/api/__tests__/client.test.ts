import { setTokens, clearTokens } from '@/lib/secure-store';
import { useAuthStore } from '@/stores/auth-store';

import { ApiError, login, logout, register } from '../client';

jest.mock('@/lib/secure-store', () => ({
  setTokens: jest.fn(),
  clearTokens: jest.fn(),
}));

const initialState = useAuthStore.getState();

describe('api client', () => {
  beforeEach(() => {
    useAuthStore.setState(initialState, true);
    jest.clearAllMocks();
  });

  it('register posts to /auth/register and returns the parsed body', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({
        user_id: 'u1',
        access_token: 'a1',
        refresh_token: 'r1',
        user: { id: 'u1', email: 'a@example.com', name: 'A' },
      }),
    });

    const result = await register({
      email: 'a@example.com',
      password: 'password123',
      name: 'A',
      kvkk_consent: true,
    });

    expect(result.access_token).toBe('a1');
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/auth/register'),
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('login throws ApiError on 401', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ detail: 'Email or password is incorrect' }),
    });

    await expect(login({ email: 'a@example.com', password: 'wrong' })).rejects.toBeInstanceOf(
      ApiError
    );
  });

  it('retries an authenticated request once after refreshing on 401', async () => {
    useAuthStore.setState({ accessToken: 'expired', refreshToken: 'refresh-1' });

    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({ detail: 'expired' }) })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          access_token: 'new-a',
          refresh_token: 'new-r',
          user: { id: 'u1', email: 'a@example.com', name: 'A' },
        }),
      })
      .mockResolvedValueOnce({ ok: true, status: 204, json: async () => ({}) });
    global.fetch = fetchMock;

    await logout({ refresh_token: 'refresh-1' });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(setTokens).toHaveBeenCalledWith('new-a', 'new-r');
    expect(useAuthStore.getState().accessToken).toBe('new-a');
  });

  it('clears the session when refresh also fails after a 401', async () => {
    useAuthStore.setState({ accessToken: 'expired', refreshToken: 'refresh-1' });

    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({ detail: 'expired' }) })
      .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({ detail: 'invalid' }) });
    global.fetch = fetchMock;

    await expect(logout({ refresh_token: 'refresh-1' })).rejects.toBeInstanceOf(ApiError);
    expect(clearTokens).toHaveBeenCalled();
    expect(useAuthStore.getState().status).toBe('unauthenticated');
  });
});
