import { getTokens } from '@/lib/secure-store';

import { useAuthStore } from '../auth-store';

jest.mock('@/lib/secure-store', () => ({
  getTokens: jest.fn(),
}));

const initialState = useAuthStore.getState();

describe('auth-store', () => {
  beforeEach(() => {
    useAuthStore.setState(initialState, true);
    jest.clearAllMocks();
  });

  it('starts in loading status', () => {
    expect(useAuthStore.getState().status).toBe('loading');
  });

  it('bootstrap sets authenticated when tokens are stored', async () => {
    (getTokens as jest.Mock).mockResolvedValue({
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
    });

    await useAuthStore.getState().bootstrap();

    const state = useAuthStore.getState();
    expect(state.status).toBe('authenticated');
    expect(state.accessToken).toBe('access-1');
    expect(state.refreshToken).toBe('refresh-1');
  });

  it('bootstrap sets unauthenticated when no tokens are stored', async () => {
    (getTokens as jest.Mock).mockResolvedValue(null);

    await useAuthStore.getState().bootstrap();

    expect(useAuthStore.getState().status).toBe('unauthenticated');
  });

  it('setSession stores the user and tokens and marks authenticated', () => {
    const user = { id: 'u1', email: 'a@example.com', name: 'A' };

    useAuthStore.getState().setSession(user, { accessToken: 'access-1', refreshToken: 'refresh-1' });

    const state = useAuthStore.getState();
    expect(state.status).toBe('authenticated');
    expect(state.user).toEqual(user);
    expect(state.accessToken).toBe('access-1');
    expect(state.refreshToken).toBe('refresh-1');
  });

  it('clearSession resets to unauthenticated with no user or tokens', () => {
    useAuthStore
      .getState()
      .setSession({ id: 'u1', email: 'a@example.com', name: 'A' }, {
        accessToken: 'access-1',
        refreshToken: 'refresh-1',
      });

    useAuthStore.getState().clearSession();

    const state = useAuthStore.getState();
    expect(state.status).toBe('unauthenticated');
    expect(state.user).toBeNull();
    expect(state.accessToken).toBeNull();
    expect(state.refreshToken).toBeNull();
  });
});
