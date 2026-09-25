import { clearTokens, setTokens } from '@/lib/secure-store';
import { useAuthStore } from '@/stores/auth-store';
import { crashReporter } from '@/lib/crash-reporter';

import { emitApiError, messageForStatus } from './error-bus';
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

let refreshPromise: Promise<void> | null = null;

/** Backend detail for 403s from `get_verified_user`. */
export const VERIFICATION_REQUIRED = 'Email or phone verification required';

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

export type BookSearchResponse = components['schemas']['BookSearchResponse'];
export type BookSearchResult = components['schemas']['BookSearchResult'];

export interface BBoxParams {
  min_lat: number;
  max_lat: number;
  min_lng: number;
  max_lng: number;
  category?: string;
  language?: string;
  condition?: string;
  q?: string;
  limit?: number;
}

export interface ClusterPoint {
  centroid: { lat: number; lng: number };
  book_ids: string[];
  count: number;
  front_cover_url: string | null;
  front_thumbnail_url: string | null;
  front_title: string;
  categories: string[];
}

export interface ClusterResponse {
  clusters: ClusterPoint[];
  singletons: BookSearchResult[];
}

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
  if (__DEV__) {
    console.log(`[API] ${method} ${url}${body !== undefined ? ` body=${JSON.stringify(body)}` : ''}`);
  }
  const start = Date.now();
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    // Server unreachable / DNS / timeout — fetch rejects with a TypeError.
    // Surface an animated popup and throw a typed error (status 0) instead of
    // letting the raw rejection crash the app.
    console.log(`[API] ${method} ${url} → network error`, err);
    emitApiError({ kind: 'network', status: 0, message: messageForStatus(0) });
    // Auto-report network failures so we can track backend reliability
    crashReporter.captureError(err, 'ApiNetworkError');
    throw new ApiError(0, { detail: 'network_error' });
  }
  const duration = Date.now() - start;
  console.log(`[API] ${method} ${url} → ${res.status} (${duration}ms)`);
  crashReporter.addBreadcrumb('api_call', `${method} ${url}`, {
    status: res.status,
    duration_ms: duration,
  });
  return res;
}

async function safeJson(res: Response): Promise<unknown> {
  if (res.status === 204) return undefined;
  try {
    return await res.json();
  } catch {
    // Error pages (e.g. a 502 HTML body) aren't JSON — don't crash on parse.
    return undefined;
  }
}

async function parse<T>(res: Response): Promise<T> {
  const data = await safeJson(res);
  if (!res.ok) {
    // 5xx → backend is down/erroring. Show the animated popup globally.
    if (res.status >= 500) {
      emitApiError({ kind: 'server', status: res.status, message: messageForStatus(res.status) });
      // Auto-report 5xx so we can catch backend regressions quickly
      crashReporter.captureError(
        new Error(`Server ${res.status}: ${res.url} → ${JSON.stringify(data ?? null).slice(0, 500)}`),
        'ApiServerError',
      );
    }
    if (res.status === 403 && (data as { detail?: unknown } | undefined)?.detail === VERIFICATION_REQUIRED) {
      // Unverified account tried a verified-only action → take them to the
      // code screen instead of surfacing a cryptic error.
      import('expo-router')
        .then(({ router }) => router.push('/verify-email'))
        .catch(() => {});
    }
    throw new ApiError(res.status, data);
  }
  return data as T;
}

export async function authedRequest<T>(
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
      if (!refreshPromise) {
        refreshPromise = (async () => {
          const tokens = await refresh({ refresh_token: refreshToken });
          await setTokens(tokens.access_token, tokens.refresh_token);
          useAuthStore.setState({
            accessToken: tokens.access_token,
            refreshToken: tokens.refresh_token,
          });
        })().finally(() => {
          refreshPromise = null;
        });
      }
      try {
        await refreshPromise;
      } catch {
        // Refresh failed — refresh token is also expired/invalid.
        // Clear everything and force re-login instead of looping 401s.
        await clearTokens();
        clearSession();
        throw new ApiError(res.status, await res.text());
      }
      const currentToken = useAuthStore.getState().accessToken;
      return authedRequest<T>(path, method, body, { allowRetry: false, query });
    } else {
      await clearTokens();
      clearSession();
    }
  }

  return parse<T>(res);
}

export const apiClient = {
  async post(path: string, body: unknown) {
    const { accessToken } = useAuthStore.getState();
    return rawRequest(path, 'POST', body, accessToken);
  },
  async delete(path: string) {
    const { accessToken } = useAuthStore.getState();
    return rawRequest(path, 'DELETE', undefined, accessToken);
  },
};

export async function register(body: RegisterBody): Promise<RegisterResponse> {
  return authedRequest<RegisterResponse>('/auth/register', 'POST', body);
}

export async function checkUsernameAvailable(username: string): Promise<{ available: boolean }> {
  return authedRequest<{ available: boolean }>('/auth/username-available', 'GET', undefined, {
    query: { username },
  });
}

export async function login(body: LoginBody): Promise<TokenResponse> {
  return authedRequest<TokenResponse>('/auth/login', 'POST', body);
}

export type GoogleLoginResponse = TokenResponse & { is_new_user?: boolean };

/** Exchange a Google ID token for MeetBook tokens. New accounts need KVKK consent. */
export async function loginWithGoogle(idToken: string, kvkkConsent = false): Promise<GoogleLoginResponse> {
  const res = await rawRequest('/auth/google', 'POST', { id_token: idToken, kvkk_consent: kvkkConsent });
  return parse<GoogleLoginResponse>(res);
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
  lat?: number;
  lng?: number;
  radius_km?: number;
  category?: string;
  language?: string;
  condition?: string;
  q?: string;
  owner_id?: string;
  limit?: number;
  cursor?: string;
}): Promise<{
  items: Array<{
    id: string;
    owner_id: string;
    owner_name: string;
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
    photos: Array<{ id: string; url: string; thumbnail_url?: string; position: number }>;
    created_at: string;
    updated_at: string;
  }>;
  next_cursor?: string;
}> {
  return authedRequest('/books/search', 'GET', undefined, { query: params });
}

export async function searchBboxBooks(
  params: BBoxParams,
): Promise<BookSearchResponse> {
  return authedRequest<BookSearchResponse>('/books/search-bbox', 'GET', undefined, {
    query: params as any,
  });
}

export async function getBookClusters(
  params: BBoxParams,
): Promise<ClusterResponse> {
  return authedRequest<ClusterResponse>('/books/clusters', 'GET', undefined, {
    query: params as any,
  });
}

export async function getBook(bookId: string): Promise<BookView> {
  return authedRequest<BookView>(`/books/${bookId}`, 'GET', undefined);
}

export async function updateBook(bookId: string, body: BookUpdateBody): Promise<BookOwnerView> {
  return authedRequest<BookOwnerView>(`/books/${bookId}`, 'PATCH', body);
}

export async function deleteBook(bookId: string, force?: boolean): Promise<void> {
  return authedRequest<void>(`/books/${bookId}`, 'DELETE', undefined, {
    query: force ? { force: 'true' } : undefined,
  });
}

export async function reorderBooks(reorders: { book_id: string; sort_order: number }[]): Promise<BookListResponse> {
  return authedRequest<BookListResponse>('/books/reorder', 'PATCH', { reorders });
}

export async function incrementBookView(bookId: string): Promise<void> {
  return authedRequest<void>(`/books/${bookId}/view`, 'POST', undefined);
}

export async function addFavorite(bookId: string): Promise<void> {
  return authedRequest<void>(`/books/${bookId}/favorite`, 'POST', undefined);
}

export async function removeFavorite(bookId: string): Promise<void> {
  return authedRequest<void>(`/books/${bookId}/favorite`, 'DELETE', undefined);
}

export async function uploadBookPhoto(
  bookId: string,
  uri: string,
  contentType: string,
): Promise<{ id: string; url: string; thumbnail_url?: string; position: number }> {
  const { accessToken } = useAuthStore.getState();

  let thumbUri: string | null = null;
  try {
    const ImageManipulator = await import('expo-image-manipulator');
  const thumbResult = await ImageManipulator.manipulateAsync(
    uri,
      [{ resize: { width: 80, height: 220 } }],
    { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG },
  );
    thumbUri = thumbResult.uri;
    console.log('[uploadBookPhoto] thumbnail created:', thumbUri);
  } catch (e) {
    console.warn('[uploadBookPhoto] thumbnail resize failed, uploading without:', e);
  }

  const formData = new FormData();

  // Original file
  const filename = uri.split('/').pop() || 'photo.jpg';
  formData.append('file', {
    uri,
    name: filename,
    type: contentType,
  } as unknown as Blob);

  // Thumbnail file (if resize succeeded)
  if (thumbUri) {
    formData.append('thumbnail', {
      uri: thumbUri,
      name: `thumb_${filename}`,
      type: 'image/jpeg',
    } as unknown as Blob);
  }

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

export async function uploadBookPhotoThumbnail(
  bookId: string,
  photoId: string,
  originalUri: string,
): Promise<{ id: string; url: string; thumbnail_url?: string; position: number }> {
  const { accessToken } = useAuthStore.getState();

  // Resize to 80×45 on-device
  const { manipulateAsync, SaveFormat } = await import('expo-image-manipulator');
  const thumbResult = await manipulateAsync(
    originalUri,
    [{ resize: { width: 80, height: 45 } }],
    { compress: 0.8, format: SaveFormat.JPEG },
  );

  const formData = new FormData();
  formData.append('file', {
    uri: thumbResult.uri,
    name: `thumb_${photoId}.jpg`,
    type: 'image/jpeg',
  } as unknown as Blob);

  const url = `${BASE_URL}/books/${bookId}/photos/${photoId}/thumbnail`;
  const res = await fetch(url, {
    method: 'PATCH',
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

export async function reorderBookPhotos(
  bookId: string,
  photoIds: string[],
): Promise<Array<{ id: string; url: string; thumbnail_url?: string; position: number }>> {
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
  isbn: string | null;
  title?: string;
  author?: string;
  notes?: string;
  created_at: string;
};

export async function getWishlist(): Promise<{ items: WishlistItem[] }> {
  return authedRequest('/wishlist', 'GET', undefined);
}

export async function addToWishlist(body: {
  isbn?: string;
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

// --- Borrow / lending lifecycle ---

export async function uploadLoanPhoto(
  exchangeId: string,
  uri: string,
  contentType: string,
): Promise<{ url: string }> {
  const { accessToken } = useAuthStore.getState();
  const formData = new FormData();
  const filename = uri.split('/').pop() || 'photo.jpg';
  formData.append('file', {
    uri,
    name: filename,
    type: contentType,
  } as unknown as Blob);

  const res = await fetch(`${BASE_URL}/exchanges/${exchangeId}/photo`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: formData,
  });
  const data = await res.json();
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

export async function lendExchange(
  exchangeId: string,
  photoUrl: string,
): Promise<ExchangeDetail> {
  return authedRequest<ExchangeDetail>(`/exchanges/${exchangeId}/lend`, 'POST', {
    photo_url: photoUrl,
  });
}

export async function returnExchange(
  exchangeId: string,
  photoUrl: string,
): Promise<ExchangeDetail> {
  return authedRequest<ExchangeDetail>(`/exchanges/${exchangeId}/return`, 'POST', {
    photo_url: photoUrl,
  });
}

export async function confirmExchangeReturn(exchangeId: string): Promise<ExchangeDetail> {
  return authedRequest<ExchangeDetail>(`/exchanges/${exchangeId}/confirm-return`, 'POST', undefined);
}

export async function requestExchangeExtension(
  exchangeId: string,
  days: number,
): Promise<ExchangeDetail> {
  return authedRequest<ExchangeDetail>(`/exchanges/${exchangeId}/extension`, 'POST', { days });
}

export async function approveExchangeExtension(exchangeId: string): Promise<ExchangeDetail> {
  return authedRequest<ExchangeDetail>(
    `/exchanges/${exchangeId}/extension/approve`,
    'POST',
    undefined,
  );
}

export async function rejectExchangeExtension(exchangeId: string): Promise<ExchangeDetail> {
  return authedRequest<ExchangeDetail>(
    `/exchanges/${exchangeId}/extension/reject`,
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
    photos: Array<{ url: string; thumbnail_url?: string; position: number }>;
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
export type MeetupOffer = components['schemas']['MeetupOffer'];
export type MeetupOfferView = components['schemas']['MeetupOfferView'];
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
  body: MeetupAcceptBody = { offer_index: 0, acknowledge_warning: false },
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
// Nerdeyim Modu — live location sharing
// ---------------------------------------------------------------------------

export type LocationPrecision = 'exact' | 'approximate';

export interface LocationUpdateBody {
  latitude: number;
  longitude: number;
  precision?: LocationPrecision;
}

export interface PartnerLocation {
  latitude: number;
  longitude: number;
  updated_at: string;
  precision?: LocationPrecision;
}

export async function updateLocation(exchangeId: string, body: LocationUpdateBody): Promise<void> {
  return authedRequest<void>(`/exchanges/${exchangeId}/location`, 'POST', body);
}

export async function getPartnerLocation(exchangeId: string): Promise<PartnerLocation | null> {
  return authedRequest<PartnerLocation | null>(
    `/exchanges/${exchangeId}/location/partner`,
    'GET',
    undefined,
  );
}

export async function stopLocationSharing(exchangeId: string): Promise<void> {
  return authedRequest<void>(`/exchanges/${exchangeId}/location`, 'DELETE', undefined);
}

export interface LocationStatus {
  me_sharing: boolean;
  partner_sharing: boolean;
  partner_location: PartnerLocation | null;
}

/** Both participants' sharing state in one call — the UI's source of truth. */
export async function getLocationStatus(exchangeId: string): Promise<LocationStatus> {
  return authedRequest<LocationStatus>(
    `/exchanges/${exchangeId}/location/status`,
    'GET',
    undefined,
  );
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

export type BlockCreateBody =
  paths['/api/v1/exchanges/blocks']['post']['requestBody']['content']['application/json'];
export type BlockListResponse =
  paths['/api/v1/exchanges/blocks']['get']['responses'][200]['content']['application/json'];

export async function blockUser(body: BlockCreateBody): Promise<void> {
  return authedRequest<void>('/exchanges/blocks', 'POST', body);
}

export async function listBlockedUsers(): Promise<BlockListResponse> {
  return authedRequest<BlockListResponse>('/exchanges/blocks', 'GET', undefined);
}

export async function unblockUser(blockedUserId: string): Promise<void> {
  return authedRequest<void>(`/exchanges/blocks/${blockedUserId}`, 'DELETE', undefined);
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export type ReportCreateBody =
  paths['/api/v1/reports']['post']['requestBody']['content']['application/json'];
export type ReportView =
  paths['/api/v1/reports']['post']['responses'][201]['content']['application/json'];

export async function createReport(body: ReportCreateBody): Promise<ReportView> {
  return authedRequest<ReportView>('/reports', 'POST', body);
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export type NotificationListResponse =
  paths['/api/v1/notifications']['get']['responses'][200]['content']['application/json'];
export type NotificationMarkReadBody =
  paths['/api/v1/notifications/read']['post']['requestBody']['content']['application/json'];

export async function listNotifications(): Promise<NotificationListResponse> {
  return authedRequest<NotificationListResponse>('/notifications', 'GET', undefined);
}

export async function markNotificationsRead(body: NotificationMarkReadBody): Promise<void> {
  return authedRequest<void>('/notifications/read', 'POST', body);
}

// ---------------------------------------------------------------------------
// Ratings
// ---------------------------------------------------------------------------

export type RatingCreateBody =
  paths['/api/v1/ratings']['post']['requestBody']['content']['application/json'];
export type RatingView =
  paths['/api/v1/ratings']['post']['responses'][201]['content']['application/json'];
export type RatingListResponse =
  paths['/api/v1/users/{user_id}/ratings']['get']['responses'][200]['content']['application/json'];

export async function createRating(body: RatingCreateBody): Promise<RatingView> {
  return authedRequest<RatingView>('/ratings', 'POST', body);
}

export async function getUserRatings(userId: string): Promise<RatingListResponse> {
  return authedRequest<RatingListResponse>(`/users/${userId}/ratings`, 'GET', undefined);
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
  paths['/api/v1/auth/me']['get']['responses'][200]['content']['application/json'] & {
    /** false until the 6-digit email code is confirmed (only when SMTP is on). */
    email_verified?: boolean;
    /** false for Google-only accounts (no password set yet). */
    has_password?: boolean;
  };
export type UpdateMeBody =
  paths['/api/v1/auth/me']['patch']['requestBody']['content']['application/json'];

export async function getMe(): Promise<MeResponse> {
  return authedRequest<MeResponse>('/auth/me', 'GET', undefined);
}

// ---------------------------------------------------------------------------
// Email verification + password reset (6-digit codes sent by email)
// ---------------------------------------------------------------------------

export async function verifyEmail(code: string): Promise<{ message: string }> {
  return authedRequest('/auth/verify-email', 'POST', { code });
}

export async function resendVerificationEmail(): Promise<{ message: string }> {
  return authedRequest('/auth/verify-email/resend', 'POST', undefined);
}

export async function updateMe(body: UpdateMeBody): Promise<MeResponse> {
  return authedRequest<MeResponse>('/auth/me', 'PATCH', body);
}

// KVKK account deletion — anonymizes PII server-side. Backend endpoint may not
// exist yet; callers should surface errors gracefully and keep the confirmation
// flow intact so the legal UX is shipped regardless of backend readiness.
export async function deleteAccount(body: { password: string }): Promise<void> {
  return authedRequest<void>('/auth/me', 'DELETE', body);
}

// ---------------------------------------------------------------------------
// User public profile
// ---------------------------------------------------------------------------

export type UserPublicProfile = {
  id: string;
  name: string;
  username?: string;
  completed_exchanges: number;
  rating_average: number;
  rating_count: number;
  loans_borrowed_count?: number;
  trust_score?: number;
  trust_badge?: string;
  trust_label?: string;
};

export interface UserSearchResult {
  id: string;
  name: string;
  username?: string;
  avatar_url?: string | null;
}

export async function searchUsers(query: string): Promise<{ items: UserSearchResult[] }> {
  return authedRequest<{ items: UserSearchResult[] }>('/auth/users/search', 'GET', undefined, {
    query: { q: query },
  });
}

export async function getUser(userId: string): Promise<UserPublicProfile> {
  return authedRequest<UserPublicProfile>(`/auth/users/${userId}`, 'GET', undefined);
}

// ---------------------------------------------------------------------------
// Geofence
// ---------------------------------------------------------------------------

export interface GeofenceAlertView {
  id: string;
  wishlist_item_id: string;
  book_id: string;
  created_at: string;
  read_at: string | null;
}

export interface GeofenceAlertListResponse {
  items: GeofenceAlertView[];
}

export async function getGeofenceAlerts(): Promise<GeofenceAlertListResponse> {
  return authedRequest<GeofenceAlertListResponse>('/geofence/alerts', 'GET', undefined);
}

export async function markGeofenceAlertRead(alertId: string): Promise<void> {
  return authedRequest<void>(`/geofence/alerts/${alertId}/read`, 'PATCH', undefined);
}

export async function updateGeofenceRadius(radiusKm: number): Promise<MeResponse> {
  return authedRequest<MeResponse>('/auth/me', 'PATCH', { geofence_radius_km: radiusKm });
}

// ---------------------------------------------------------------------------
// Avatar upload
// ---------------------------------------------------------------------------

export async function uploadAvatar(uri: string, contentType = 'image/jpeg'): Promise<{ avatar_url: string }> {
  const { accessToken } = useAuthStore.getState();
  const formData = new FormData();
  const filename = uri.split('/').pop() || 'avatar.jpg';
  formData.append('file', {
    uri,
    name: filename,
    type: contentType,
  } as unknown as Blob);

  const url = `${BASE_URL}/auth/me/avatar`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: formData,
  });
  const data = await res.json();
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

// ---------------------------------------------------------------------------
// Saved Searches
// ---------------------------------------------------------------------------

export type SavedSearchItem = {
  id: string;
  name: string;
  params: {
    category: string | null;
    radius_km: number;
    lat: number;
    lng: number;
  };
  created_at: string;
};

export async function getSavedSearches(): Promise<{ items: SavedSearchItem[] }> {
  return authedRequest('/saved-searches', 'GET', undefined);
}

export async function createSavedSearch(body: {
  name: string;
  params: SavedSearchItem['params'];
}): Promise<SavedSearchItem> {
  return authedRequest('/saved-searches', 'POST', body);
}

export async function updateSavedSearch(id: string, body: { name: string }): Promise<SavedSearchItem> {
  return authedRequest(`/saved-searches/${id}`, 'PUT', body);
}

export async function deleteSavedSearch(id: string): Promise<void> {
  return authedRequest(`/saved-searches/${id}`, 'DELETE', undefined);
}
