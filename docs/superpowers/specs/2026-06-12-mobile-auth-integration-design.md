# Mobile API & Auth Integration: Design Spec

> **Status:** Approved
> **Date:** 2026-06-12
> **Approach:** Vertical Slices (build each feature end-to-end, same pattern as Phase 1)
> **Context:** Phase 2's DoD requires "register→verify→login→logout works on a device against
> the real API" and a "generated OpenAPI client", but only the design-system/app-shell part of
> Phase 2 was built — `src/lib`, `src/stores`, `src/features` are empty, and there is no auth
> UI. Books CRUD (Phase 3 sub-project #1) needs an authenticated API client, so this gap is
> closed first as its own sub-project.
>
> **Simplifications agreed for now:** no phone OTP / 2FA (deferred to its original phase), no
> i18n library — UI strings are hardcoded Turkish. Forgot-password screens deferred (backend
> endpoints already exist from Phase 1 and can be wired up later without rework).

---

## 1. Backend Additions

All changes inside the existing `backend/app/modules/auth/` module — no new module.

### Migration: KVKK consent columns

Add to `users`:

| Column | Type | Notes |
|---|---|---|
| `kvkk_consent_at` | timestamptz NOT NULL | Set at registration |
| `kvkk_policy_version` | text NOT NULL | Set at registration, e.g. `"1.0"` |

A module-level constant `CURRENT_KVKK_POLICY_VERSION = "1.0"` lives in
`app/modules/auth/service.py`.

### `RegisterRequest` — add `kvkk_consent`

```python
class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    name: str = Field(min_length=1, max_length=100)
    kvkk_consent: bool
```

`AuthService.register` raises `AuthError("KVKK consent is required", 422)` if
`kvkk_consent is not True` (checked in the service, not just relying on the bool type, so the
error message is meaningful). On success, sets `kvkk_consent_at = now()`,
`kvkk_policy_version = CURRENT_KVKK_POLICY_VERSION`, and **`email_verified_at = now()`**
(auto-verify — no email verification flow exists yet; unblocks `get_verified_user` for
Books CRUD).

### Response shapes — add `user`

```python
class UserPublic(BaseModel):
    id: uuid.UUID
    email: EmailStr
    name: str


class AuthTokensResponse(BaseModel):
    user_id: uuid.UUID
    access_token: str
    refresh_token: str
    user: UserPublic


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    user: UserPublic
```

`AuthService.register` and `AuthService.login` both build `UserPublic` from the `User` row and
include it in their responses. This matches the contract documented in
`BACKEND_API_PLAN.md` (`POST /login` → `{access_token, refresh_token, user}`).

---

## 2. Mobile Dependencies

New packages (added to `mobile/package.json`):

- `@tanstack/react-query` — server state
- `zustand` — auth/session state
- `expo-secure-store` — token storage (DoD: tokens never in AsyncStorage)
- `openapi-typescript` (dev) — generates TS types from `/api/openapi.json`

---

## 3. Mobile Data Layer

### `src/lib/api/schema.d.ts` (generated, committed)

Generated via:

```bash
npx openapi-typescript http://localhost:8000/api/openapi.json -o src/lib/api/schema.d.ts
```

Exposed as an npm script `gen:api` in `package.json`. Regenerated whenever the backend's
OpenAPI schema changes (manual step for now — no CI enforcement in this slice).

### `src/lib/api/client.ts`

A thin fetch wrapper typed against `schema.d.ts`:

- Base URL: `process.env.EXPO_PUBLIC_API_URL` (already in `.env.example`,
  `http://localhost:8000/api/v1`)
- Attaches `Authorization: Bearer <accessToken>` from `useAuthStore.getState().accessToken`
  when present
- On `401` response (and an access token was sent): calls `POST /auth/refresh` with the
  stored refresh token once. On success, updates tokens (store + SecureStore) and retries the
  original request once. On failure, calls `useAuthStore.getState().clearSession()` and
  `clearTokens()`, then rejects with the original 401.
- Exposes typed helper functions per endpoint needed this slice: `register(body)`,
  `login(body)`, `refresh(body)`, `logout(body)`.

### `src/lib/secure-store.ts`

```ts
export async function getTokens(): Promise<{ accessToken: string; refreshToken: string } | null>
export async function setTokens(accessToken: string, refreshToken: string): Promise<void>
export async function clearTokens(): Promise<void>
```

Wraps `expo-secure-store` with keys `access_token` / `refresh_token`.

### `src/lib/query-client.ts`

```ts
export const queryClient = new QueryClient();
```

Used once, in a `QueryClientProvider` in the root layout.

### `src/stores/auth-store.ts` (Zustand)

```ts
type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

interface AuthState {
  status: AuthStatus;
  user: UserPublic | null;
  accessToken: string | null;
  refreshToken: string | null;
  setSession: (user: UserPublic, tokens: { accessToken: string; refreshToken: string }) => void;
  clearSession: () => void;
  bootstrap: () => Promise<void>; // reads SecureStore, sets status accordingly
}
```

`bootstrap()` reads tokens from SecureStore on app start. If present, sets
`status = 'authenticated'` with those tokens (user is re-fetched lazily — for this slice, if
no cached user is available, `status` still becomes `'authenticated'`; the Profile tab will
show a generic state until the user logs in again — acceptable since there's no `/users/me`
endpoint yet). If absent, `status = 'unauthenticated'`.

---

## 4. Screens & Navigation

All UI copy hardcoded Turkish (no i18n library).

### `src/app/_layout.tsx` (modified)

- Wraps existing content in `QueryClientProvider value={queryClient}`.
- Calls `useAuthStore().bootstrap()` once on mount; while `status === 'loading'`, the existing
  `AnimatedSplashOverlay` continues to show.
- Uses `<Stack.Protected guard={...}>` (verify exact API against
  `https://docs.expo.dev/versions/v56.0.0/router/reference/authentication/` during
  implementation) to render the `auth` group when `status === 'unauthenticated'` and the
  `tabs` group when `status === 'authenticated'`.

### `src/app/auth/_layout.tsx` (new)

Plain `Stack` (no header), containing `login` and `register` screens.

### `src/app/auth/login.tsx` (new)

- Email + password `Input`s, "Giriş yap" `Button`.
- On submit: `client.login({ email, password })`. On success: `setTokens(...)` then
  `setSession(user, tokens)` — the Protected guard re-renders into `tabs` automatically.
- On `401`: inline error "E-posta veya şifre hatalı."
- "Hesabın yok mu? Kayıt ol" link → `auth/register`.

### `src/app/auth/register.tsx` (new)

- Name, email, password `Input`s, KVKK consent `Checkbox`-style control (a `Pressable` +
  `Badge`/text since no dedicated checkbox component exists yet — reuse existing primitives,
  don't add a new design-system component in this slice). Submit disabled until checked.
- On submit: `client.register({ email, password, name, kvkk_consent: true })`. Same
  session-setting flow as login.
- On `409`: inline error "Bu e-posta zaten kayıtlı."
- On `422` (weak password / consent missing): inline error "Şifre en az 8 karakter olmalı"
  (password) — consent error shouldn't occur since the UI blocks submit.
- "Hesabın var mı? Giriş yap" link → `auth/login`.

### Profile tab (`src/app/tabs/profile.tsx`, modified)

- Shows `user?.name` / `user?.email` from the auth store if available.
- "Çıkış yap" button: calls `client.logout({ refresh_token: refreshToken })` (best-effort,
  catch and ignore errors), then `clearTokens()` + `clearSession()`. Protected guard switches
  back to `auth`.

---

## 5. File Structure

```
backend/app/modules/auth/
  schemas.py     ← MODIFIED: RegisterRequest.kvkk_consent, UserPublic, response shapes
  service.py     ← MODIFIED: kvkk_consent validation, email auto-verify, UserPublic in responses
backend/alembic/versions/
  <new>          ← NEW: add kvkk_consent_at, kvkk_policy_version to users
backend/tests/auth/
  test_register.py  ← MODIFIED: kvkk_consent in payloads, assert new response fields
  test_login.py     ← MODIFIED: assert `user` field in response

mobile/
  package.json   ← MODIFIED: new deps + gen:api script
  src/lib/api/
    schema.d.ts  ← NEW (generated)
    client.ts    ← NEW
  src/lib/
    secure-store.ts  ← NEW
    query-client.ts  ← NEW
  src/stores/
    auth-store.ts    ← NEW
  src/app/
    _layout.tsx        ← MODIFIED
    auth/_layout.tsx   ← NEW
    auth/login.tsx     ← NEW
    auth/register.tsx  ← NEW
    tabs/profile.tsx   ← MODIFIED
  src/lib/__tests__/
    auth-store.test.ts ← NEW
  src/app/auth/__tests__/
    login.test.tsx     ← NEW
    register.test.tsx  ← NEW
```

---

## 6. Implementation Order (Vertical Slices)

| # | Slice | Files | Test Coverage |
|---|---|---|---|
| 1 | **Backend: KVKK + auto-verify + user in response** | migration, `schemas.py`, `service.py` | `test_register.py` (kvkk_consent required, response has `user`/`kvkk_consent_at` effects, email auto-verified), `test_login.py` (response has `user`) |
| 2 | **Mobile foundations** | deps install, `schema.d.ts` (generated), `client.ts`, `secure-store.ts`, `query-client.ts` | type-check passes; client types compile against generated schema |
| 3 | **Auth store** | `auth-store.ts` | `auth-store.test.ts` — bootstrap with/without stored tokens, setSession/clearSession transitions |
| 4 | **Login + navigation gating** | `_layout.tsx`, `auth/_layout.tsx`, `auth/login.tsx` | `login.test.tsx` — renders, validation, success sets session, 401 shows error |
| 5 | **Register** | `auth/register.tsx` | `register.test.tsx` — KVKK checkbox gating, success, 409 error |
| 6 | **Logout** | `tabs/profile.tsx` | component test — logout clears session and tokens |

---

## 7. Definition of Done

- [ ] Migration adds `kvkk_consent_at`/`kvkk_policy_version`; `alembic check` passes
- [ ] `POST /auth/register` rejects `kvkk_consent: false` with `422`; on success sets
      `email_verified_at`, `kvkk_consent_at`, `kvkk_policy_version`
- [ ] `POST /auth/register` and `POST /auth/login` responses include `user: {id, email, name}`
- [ ] Mobile: register → land on tabs (no manual navigation needed) → kill/reopen app → still
      authenticated (SecureStore persisted) → log out → back to login screen
- [ ] Tokens are never written to AsyncStorage (only SecureStore) — verified by code review
      (no AsyncStorage import in the auth/session code paths)
- [ ] All new code passes ruff/mypy/eslint/tsc; backend + mobile test suites green
