import { clearTokens, setTokens } from '@/lib/secure-store';
import { useAuthStore } from '@/stores/auth-store';

import type { components, paths } from './schema';

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

export type BookCreateBody =
  paths['/api/v1/books']['post']['requestBody']['content']['application/json'];
export type BookUpdateBody =
  paths['/api/v1/books/{book_id}']['patch']['requestBody']['content']['application/json'];
export type BookOwnerView =
  paths['/api/v1/books']['post']['responses'][201]['content']['application/json'];
export type BookListResponse =
  paths['/api/v1/books/me']['get']['responses'][200]['content']['application/json'];
export type BookView =
  paths['/api/v1/books/{book_id}']['get']['responses'][200]['content']['application/json'];

async function rawRequest(
  path: string,
  method: string,
  body: unknown,
  accessToken?: string | null,
  query?: Record<string, string | number | undefined>,
) {
  const search = query
    ? Object.entries(query)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
        .join('&')
    : '';
  const url = `${BASE_URL}${path}${search ? `?${search}` : ''}`;
  console.log(`[API] ${method} ${url}${body !== undefined ? ` body=${JSON.stringify(body)}` : ''}`);
  const start = Date.now();
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const duration = Date.now() - start;
  console.log(`[API] ${method} ${url} → ${res.status} (${duration}ms)`);
  return res;
}

async function parse<T>(res: Response): Promise<T> {
  const data = res.status === 204 ? undefined : await res.json();
  if (!res.ok) {
    throw new ApiError(res.status, data);
  }
  return data as T;
}

async function authedRequest<T>(
  path: string,
  method: string,
  body: unknown,
  options: { allowRetry?: boolean; query?: Record<string, string | number | undefined> } = {},
): Promise<T> {
  const { allowRetry = true, query } = options;
  const { accessToken, refreshToken, clearSession } = useAuthStore.getState();
  const res = await rawRequest(path, method, body, accessToken, query);

  if (res.status === 401 && accessToken && allowRetry) {
    if (refreshToken) {
      try {
        const tokens = await refresh({ refresh_token: refreshToken });
        await setTokens(tokens.access_token, tokens.refresh_token);
        useAuthStore.setState({
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
        });
        return authedRequest<T>(path, method, body, { allowRetry: false, query });
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
  return authedRequest<RegisterResponse>('/auth/register', 'POST', body);
}

export async function login(body: LoginBody): Promise<TokenResponse> {
  return authedRequest<TokenResponse>('/auth/login', 'POST', body);
}

export async function refresh(body: RefreshBody): Promise<TokenResponse> {
  const res = await rawRequest('/auth/refresh', 'POST', body);
  return parse<TokenResponse>(res);
}

export async function logout(body: LogoutBody): Promise<void> {
  return authedRequest<void>('/auth/logout', 'POST', body);
}

// ---------------------------------------------------------------------------
// Books
// ---------------------------------------------------------------------------

export async function createBook(body: BookCreateBody): Promise<BookOwnerView> {
  return authedRequest<BookOwnerView>('/books', 'POST', body);
}

export async function listMyBooks(params: {
  cursor?: string;
  limit?: number;
} = {}): Promise<BookListResponse> {
  return authedRequest<BookListResponse>('/books/me', 'GET', undefined, { query: params });
}

export async function listNearbyBooks(params: {
  cursor?: string;
  limit?: number;
} = {}): Promise<BookListResponse> {
  return authedRequest<BookListResponse>('/books', 'GET', undefined, { query: params });
}

export async function searchNearbyBooks(params: {
  lat: number;
  lng: number;
  radius_km?: number;
  category?: string;
  language?: string;
  condition?: string;
  q?: string;
  limit?: number;
  cursor?: string;
}): Promise<{
  items: Array<{
    id: string;
    owner_id: string;
    title: string;
    author?: string;
    isbn?: string;
    description?: string;
    category: string;
    language: string;
    condition: string;
    is_available: boolean;
    public_location: { lat: number; lng: number };
    distance_km: number;
    photos: Array<{ id: string; url: string; position: number }>;
    created_at: string;
    updated_at: string;
  }>;
  next_cursor?: string;
}> {
  return authedRequest('/books/search', 'GET', undefined, { query: params });
}

export async function getBook(bookId: string): Promise<BookView> {
  return authedRequest<BookView>(`/books/${bookId}`, 'GET', undefined);
}

export async function updateBook(bookId: string, body: BookUpdateBody): Promise<BookOwnerView> {
  return authedRequest<BookOwnerView>(`/books/${bookId}`, 'PATCH', body);
}

export async function deleteBook(bookId: string): Promise<void> {
  return authedRequest<void>(`/books/${bookId}`, 'DELETE', undefined);
}

export async function uploadBookPhoto(
  bookId: string,
  uri: string,
  contentType: string,
): Promise<{ id: string; url: string; position: number }> {
  const { accessToken } = useAuthStore.getState();
  const formData = new FormData();

  const filename = uri.split('/').pop() || 'photo.jpg';
  formData.append('file', {
    uri,
    name: filename,
    type: contentType,
  } as unknown as Blob);

  const url = `${BASE_URL}/books/${bookId}/photos`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    body: formData,
  });

  const data = await res.json();
  if (!res.ok) {
    throw new ApiError(res.status, data);
  }
  return data;
}

export async function deleteBookPhoto(bookId: string, photoId: string): Promise<void> {
  return authedRequest<void>(`/books/${bookId}/photos/${photoId}`, 'DELETE', undefined);
}

export async function reorderBookPhotos(
  bookId: string,
  photoIds: string[],
): Promise<Array<{ id: string; url: string; position: number }>> {
  return authedRequest(`/books/${bookId}/photos/reorder`, 'PATCH', { photo_ids: photoIds });
}

export async function lookupISBN(isbnCode: string): Promise<{
  isbn: string;
  title?: string;
  author?: string;
  description?: string;
  cover_url?: string;
  page_count?: number;
  published_year?: number;
}> {
  return authedRequest(`/books/isbn/${isbnCode}`, 'GET', undefined);
}

// ---------------------------------------------------------------------------
// Wishlist
// ---------------------------------------------------------------------------

export type WishlistItem = {
  id: string;
  isbn: string;
  title?: string;
  author?: string;
  notes?: string;
  created_at: string;
};

export async function getWishlist(): Promise<{ items: WishlistItem[] }> {
  return authedRequest('/wishlist', 'GET', undefined);
}

export async function addToWishlist(body: {
  isbn: string;
  title?: string;
  author?: string;
  notes?: string;
}): Promise<WishlistItem> {
  return authedRequest('/wishlist', 'POST', body);
}

export async function removeFromWishlist(itemId: string): Promise<void> {
  return authedRequest(`/wishlist/${itemId}`, 'DELETE', undefined);
}

// ---------------------------------------------------------------------------
// Exchanges
// ---------------------------------------------------------------------------

export type ExchangeCreateBody =
  paths['/api/v1/exchanges']['post']['requestBody']['content']['application/json'];
export type ExchangeDetail =
  paths['/api/v1/exchanges']['post']['responses'][201]['content']['application/json'];
export type ExchangeListResponse =
  paths['/api/v1/exchanges']['get']['responses'][200]['content']['application/json'];
export type ExchangeSummary = ExchangeListResponse['items'][number];
export type ExchangeStatus = components['schemas']['ExchangeStatus'];

export async function createExchange(body: ExchangeCreateBody): Promise<ExchangeDetail> {
  return authedRequest<ExchangeDetail>('/exchanges', 'POST', body);
}

export async function listExchanges(params: {
  role: 'sent' | 'received';
  status?: ExchangeStatus;
  cursor?: string;
  limit?: number;
}): Promise<ExchangeListResponse> {
  return authedRequest<ExchangeListResponse>('/exchanges', 'GET', undefined, { query: params });
}

export async function getExchange(exchangeId: string): Promise<ExchangeDetail> {
  return authedRequest<ExchangeDetail>(`/exchanges/${exchangeId}`, 'GET', undefined);
}

export async function acceptExchange(exchangeId: string): Promise<ExchangeDetail> {
  return authedRequest<ExchangeDetail>(`/exchanges/${exchangeId}/accept`, 'POST', undefined);
}

export async function rejectExchange(exchangeId: string): Promise<ExchangeDetail> {
  return authedRequest<ExchangeDetail>(`/exchanges/${exchangeId}/reject`, 'POST', undefined);
}

export async function cancelExchange(exchangeId: string): Promise<ExchangeDetail> {
  return authedRequest<ExchangeDetail>(`/exchanges/${exchangeId}/cancel`, 'POST', undefined);
}

export async function completeExchange(exchangeId: string): Promise<ExchangeDetail> {
  return authedRequest<ExchangeDetail>(`/exchanges/${exchangeId}/complete`, 'POST', undefined);
}

export async function confirmExchangeCompletion(exchangeId: string): Promise<ExchangeDetail> {
  return authedRequest<ExchangeDetail>(
    `/exchanges/${exchangeId}/confirm-completion`,
    'POST',
    undefined,
  );
}

export async function getWishlistMatches(): Promise<{
  matches: Array<{
    id: string;
    title: string;
    author?: string;
    isbn: string;
    condition: string;
    distance_km: number;
    photos: Array<{ url: string; position: number }>;
    created_at: string;
  }>;
}> {
  return authedRequest('/wishlist/matches', 'GET', undefined);
}

// ---------------------------------------------------------------------------
// Meetup
// ---------------------------------------------------------------------------

export type MeetupProposeBody =
  paths['/api/v1/exchanges/{exchange_id}/meetup']['post']['requestBody']['content']['application/json'];
export type MeetupAcceptBody =
  paths['/api/v1/exchanges/{exchange_id}/meetup/accept']['post']['requestBody']['content']['application/json'];
export type MeetupDetail = components['schemas']['MeetupDetail'];
export type MeetupValidationStatus = components['schemas']['MeetupValidationStatus'];
export type MeetupSuggestionsResponse =
  paths['/api/v1/exchanges/{exchange_id}/meetup/suggestions']['get']['responses'][200]['content']['application/json'];

export async function proposeMeetup(
  exchangeId: string,
  body: MeetupProposeBody,
): Promise<ExchangeDetail> {
  return authedRequest<ExchangeDetail>(`/exchanges/${exchangeId}/meetup`, 'POST', body);
}

export async function acceptMeetup(
  exchangeId: string,
  body: MeetupAcceptBody = { acknowledge_warning: false },
): Promise<ExchangeDetail> {
  return authedRequest<ExchangeDetail>(`/exchanges/${exchangeId}/meetup/accept`, 'POST', body);
}

export async function rejectMeetup(exchangeId: string): Promise<ExchangeDetail> {
  return authedRequest<ExchangeDetail>(`/exchanges/${exchangeId}/meetup/reject`, 'POST', undefined);
}

export async function getMeetupSuggestions(exchangeId: string): Promise<MeetupSuggestionsResponse> {
  return authedRequest<MeetupSuggestionsResponse>(
    `/exchanges/${exchangeId}/meetup/suggestions`,
    'GET',
    undefined,
  );
}

// ---------------------------------------------------------------------------
// Places
// ---------------------------------------------------------------------------

export type PlaceSuggestion = components['schemas']['PlaceSuggestion'];
export type PlaceSummary = components['schemas']['PlaceSummary'];

export async function placesAutocomplete(params: {
  query: string;
  lat: number;
  lng: number;
}): Promise<{ items: PlaceSuggestion[] }> {
  return authedRequest('/places/autocomplete', 'GET', undefined, { query: params });
}

export async function placeDetails(placeId: string): Promise<PlaceSummary | null> {
  return authedRequest(`/places/details/${placeId}`, 'GET', undefined);
}

export async function placesNearby(params: {
  lat: number;
  lng: number;
}): Promise<{ items: PlaceSummary[] }> {
  return authedRequest('/places/nearby', 'GET', undefined, { query: params });
}

// ---------------------------------------------------------------------------
// Profile (/auth/me)
// ---------------------------------------------------------------------------

export type MeResponse =
  paths['/api/v1/auth/me']['get']['responses'][200]['content']['application/json'];
export type UpdateMeBody =
  paths['/api/v1/auth/me']['patch']['requestBody']['content']['application/json'];

export async function getMe(): Promise<MeResponse> {
  return authedRequest<MeResponse>('/auth/me', 'GET', undefined);
}

export async function updateMe(body: UpdateMeBody): Promise<MeResponse> {
  return authedRequest<MeResponse>('/auth/me', 'PATCH', body);
}
