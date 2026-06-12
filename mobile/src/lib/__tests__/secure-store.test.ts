import * as SecureStore from 'expo-secure-store';
import { getTokens, setTokens, clearTokens } from '../secure-store';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

const mockedSecureStore = SecureStore as jest.Mocked<typeof SecureStore>;

describe('secure-store', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getTokens', () => {
    it('returns accessToken and refreshToken when both tokens exist', async () => {
      mockedSecureStore.getItemAsync.mockImplementation(async (key: string) => {
        if (key === 'access_token') return 'my-access-token';
        if (key === 'refresh_token') return 'my-refresh-token';
        return null;
      });

      const result = await getTokens();

      expect(result).toEqual({
        accessToken: 'my-access-token',
        refreshToken: 'my-refresh-token',
      });
    });

    it('returns null when access token is missing', async () => {
      mockedSecureStore.getItemAsync.mockImplementation(async (key: string) => {
        if (key === 'access_token') return null;
        if (key === 'refresh_token') return 'my-refresh-token';
        return null;
      });

      const result = await getTokens();

      expect(result).toBeNull();
    });

    it('returns null when refresh token is missing', async () => {
      mockedSecureStore.getItemAsync.mockImplementation(async (key: string) => {
        if (key === 'access_token') return 'my-access-token';
        if (key === 'refresh_token') return null;
        return null;
      });

      const result = await getTokens();

      expect(result).toBeNull();
    });
  });

  describe('setTokens', () => {
    it('calls SecureStore.setItemAsync with correct keys and values', async () => {
      await setTokens('my-access-token', 'my-refresh-token');

      expect(mockedSecureStore.setItemAsync).toHaveBeenCalledWith(
        'access_token',
        'my-access-token'
      );
      expect(mockedSecureStore.setItemAsync).toHaveBeenCalledWith(
        'refresh_token',
        'my-refresh-token'
      );
    });
  });

  describe('clearTokens', () => {
    it('calls SecureStore.deleteItemAsync for both keys', async () => {
      await clearTokens();

      expect(mockedSecureStore.deleteItemAsync).toHaveBeenCalledWith('access_token');
      expect(mockedSecureStore.deleteItemAsync).toHaveBeenCalledWith('refresh_token');
    });
  });
});
