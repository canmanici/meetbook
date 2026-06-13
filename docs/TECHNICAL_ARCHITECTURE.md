# Technical Architecture

> The stack table and module map live in `../Meetbook.md` §3–4. This document explains
> the structure in enough depth to start coding without guessing.

## Repository Layout (monorepo)

```
meetbook/
  backend/            FastAPI app (Python 3.14, managed with uv)
    app/
      core/           config.py, security.py, rate_limit.py, deps.py, db.py
      modules/<name>/ router.py, service.py, repository.py, schemas.py, models.py
      workers/        cleanup_locations.py, meetup_reminders.py, image_processing.py
      main.py         app factory: routers, middleware, exception handlers
    alembic/          migrations
    tests/
    pyproject.toml
  mobile/             Expo app (TypeScript; template uses src/ layout)
    src/app/          Expo Router routes (see below)
    src/components/ui design-system components (tokens.ts lives here)
    src/features/<name>/  hooks, api, components per feature
    src/lib/          api client, secure storage, i18n, query client
    src/stores/       zustand stores
  admin/              minimal React web dashboard (added in Phase 7)
  docker-compose.yml  postgres+postgis, redis
  .github/workflows/  ci.yml
```

## Backend Layering (every module, same shape)

```
router.py      HTTP only: parse request → call service → return schema.
service.py     Business rules: authorization, state machine, orchestration.
repository.py  DB access only: SQLAlchemy queries, no business logic.
schemas.py     Pydantic v2 request/response models. Response models are explicit.
models.py      SQLAlchemy models (GeoAlchemy2 for geography columns).
```

Rules a junior must not break:
- Routers never import models or touch the DB session directly.
- Services receive `current_user` and do the authorization check **first**.
- Repositories never raise HTTP exceptions — services translate.
- Cross-module calls go service→service, never service→foreign repository.

## Key Core Pieces

- `core/config.py` — Pydantic Settings from env vars (`DATABASE_URL`, `REDIS_URL`,
  `JWT_SECRET`, `GOOGLE_PLACES_KEY`, `S3_*`). App refuses to boot with missing secrets.
- `core/db.py` — async engine + `async_session` dependency.
- `core/security.py` — Argon2id hash/verify, JWT encode/decode, refresh-token
  create/rotate/revoke-family, OTP generate/verify.
- `core/rate_limit.py` — Redis sliding-window dependency: `Depends(RateLimit("search", 30, 60))`.
- `core/deps.py` — `get_current_user` (validates JWT, loads user, rejects suspended),
  `get_verified_user` (additionally requires phone verification).

## Realtime Chat Design

- Endpoint `/ws/chat` authenticated by a 30-second single-use ticket (see security doc §8).
- Each backend instance keeps `dict[user_id, set[WebSocket]]` of its local connections.
- Message flow: client sends → service validates membership/block/length → persist to
  Postgres → publish to Redis channel `chat:{exchange_id}` → every instance delivers to
  its local sockets. Redis pub/sub makes horizontal scaling work from day one.
- Offline recipients get an Expo push instead (notification module subscribes to the same event).

## Background Workers

Single lightweight scheduler process (APScheduler) — Celery is overkill at this stage:
- `cleanup_locations` — hourly: delete `user_locations` older than 30 days (KVKK).
- `expire_requests` — hourly: `pending`/`accepted` requests older than 14 days → `expired`.
- `meetup_reminders` — every 5 min: send 24 h / 1 h pushes for confirmed meetups.
- `ratings_reveal` — daily: reveal single-sided ratings older than 14 days.

## Mobile Architecture

```
app/
  (tabs)/ home.tsx  search.tsx  requests.tsx  chats.tsx  profile.tsx
  auth/   login.tsx  signup.tsx  verify-phone.tsx  forgot-password.tsx
  book/   [id].tsx  new.tsx  scan-isbn.tsx
  exchange/ [id].tsx            ← lifecycle timeline screen
  meetup/ select-place.tsx  confirm.tsx
  settings/ index.tsx  privacy.tsx  notifications.tsx
```

- **Server state = TanStack Query** (`['books','nearby',params]`-style keys, invalidation
  on mutations). **UI state = Zustand** (auth session, draft forms, map state). Don't put
  server data in Zustand.
- **API client generated from OpenAPI** (`openapi-typescript` + a thin fetch wrapper) —
  backend schema changes become mobile compile errors, not runtime surprises.
- Token refresh handled in the fetch wrapper: 401 → refresh once → retry → logout on failure.
- i18n via `i18next`; every string keyed from day one (`tr` default, `en` secondary).

## Map Provider Deep Links (mobile)

```ts
// lib/maps.ts — try in order, first canOpenURL wins; final fallback copies the address
const providers = (lat: number, lng: number, label: string) => [
  { name: 'Google Maps', url: `comgooglemaps://?q=${lat},${lng}`,
    web: `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}` },
  { name: 'Yandex Maps', url: `yandexmaps://maps.yandex.ru/?pt=${lng},${lat}&z=16&l=map` },
  { name: 'Apple Maps',  url: `http://maps.apple.com/?ll=${lat},${lng}&q=${encodeURIComponent(label)}` },
];
```
Android: offer Google/Yandex + geo: URI. iOS: Apple Maps is the guaranteed fallback.

## Decisions & Rationale (FAQ for the junior dev)

- **Why a modular monolith, not microservices?** One deployable, one DB, simple debugging.
  The module boundaries already exist if we ever need to split.
- **Why proxy Google Places instead of calling it from the app?** The API key would be
  extractable from the app binary; proxying lets us cache (cost) and validate (safety).
- **Why two location columns on books?** Blurring must be static (see security doc §4)
  and the true point must be structurally unexposable — `repository.search()` simply never
  selects `location` for non-owners.
- **Why native WebSockets over Socket.IO?** FastAPI supports WS natively; Redis pub/sub
  covers fan-out; one less protocol/dependency on both sides.
- **Why uv?** Fast, lockfile-based, reproducible Python env: `uv sync` and you're running.
