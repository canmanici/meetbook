import { clearTokens, setTokens } from '@/lib/secure-store';
import { useAuthStore } from '@/stores/auth-store';

import type { paths } from './schema';

const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000/api/v1';

export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, body: unknown) {
    super(`API request failed with status ${status}`);
    this.status = status;
    this.body = body;
  }
}

type RegisterBody =
  paths['/api/v1/auth/register']['post']['requestBody']['content']['application/json'];
type RegisterResponse =
  paths['/api/v1/auth/register']['post']['responses'][201]['content']['application/json'];
type LoginBody =
  paths['/api/v1/auth/login']['post']['requestBody']['content']['application/json'];
type TokenResponse =
  paths['/api/v1/auth/login']['post']['responses'][200]['content']['application/json'];
type RefreshBody =
  paths['/api/v1/auth/refresh']['post']['requestBody']['content']['application/json'];
type LogoutBody =
  paths['/api/v1/auth/logout']['post']['requestBody']['content']['application/json'];

async function rawRequest(path: string, body: unknown, accessToken?: string | null) {
  return fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function parse<T>(res: Response): Promise<T> {
  const data = res.status === 204 ? undefined : await res.json();
  if (!res.ok) {
    throw new ApiError(res.status, data);
  }
  return data as T;
}

async function authedRequest<T>(path: string, body: unknown, allowRetry = true): Promise<T> {
  const { accessToken, refreshToken, clearSession } = useAuthStore.getState();
  const res = await rawRequest(path, body, accessToken);

  if (res.status === 401 && accessToken && allowRetry) {
    if (refreshToken) {
      try {
        const tokens = await refresh({ refresh_token: refreshToken });
        await setTokens(tokens.access_token, tokens.refresh_token);
        useAuthStore.setState({
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
        });
        return authedRequest<T>(path, body, false);
      } catch {
        await clearTokens();
        clearSession();
      }
    } else {
      await clearTokens();
      clearSession();
    }
  }

  return parse<T>(res);
}

export async function register(body: RegisterBody): Promise<RegisterResponse> {
  return authedRequest<RegisterResponse>('/auth/register', body);
}

export async function login(body: LoginBody): Promise<TokenResponse> {
  return authedRequest<TokenResponse>('/auth/login', body);
}

export async function refresh(body: RefreshBody): Promise<TokenResponse> {
  const res = await rawRequest('/auth/refresh', body);
  return parse<TokenResponse>(res);
}

export async function logout(body: LogoutBody): Promise<void> {
  return authedRequest<void>('/auth/logout', body);
}
