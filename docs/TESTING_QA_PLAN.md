# Testing & QA Plan

> Tests are how we *know* the security rules hold. The security suite is not optional
> and CI blocks merges without it.

## Backend

- **Stack:** pytest + pytest-asyncio + httpx `AsyncClient`; **real PostGIS via
  testcontainers** (geospatial SQL can't be mocked faithfully); fakeredis or a Redis
  container for rate-limit tests; `freezegun` for expiry/reveal logic.
- **Layers:** unit tests for services (state machine, blur, validation), integration
  tests through the HTTP layer for every endpoint, worker tests with frozen time.
- **Factories:** factory-boy fixtures for users (unverified/verified/suspended), books
  (seeded Istanbul coordinates), exchanges in every status.

### Mandatory security suite (`tests/security/`)

1. **Authorization matrix** — parametrized over every resource endpoint: user A requests
   each of user B's resources (book edit, exchange, chat, meetup, ratings, export) →
   expect 404. This single test family catches the most damaging class of bug.
2. **Location leakage** — for every response that includes a book or user: assert true
   coordinates absent (compare against seeded exact values), distances rounded, no
   coordinates for other users' profiles.
3. **Auth attacks** — refresh replay revokes family; 6th login blocked; OTP 4th attempt
   blocked; reset-token single-use; expired JWT rejected; suspended user rejected;
   no-account vs wrong-password responses byte-identical.
4. **State machine** — full matrix of (status × action × actor): every illegal cell → 409,
   every legal cell → expected next status.
5. **Geofence & meetup safety** — point in Greece/Cyprus/sea → 422; blocked-place radius →
   rejected; residential pin without acknowledgment → 422.
6. **Rate limits** — exceed each documented limit → 429 with `Retry-After`.
7. **Uploads** — EXIF GPS stripped after pipeline; fake-extension executable rejected by
   magic-byte check; oversize rejected.
8. **Chat** — non-participant ticket cannot join; blocked sender's WS message not
   delivered; cancelled exchange closes the chat.

## Mobile

- **Unit/component:** Jest + React Native Testing Library — form validation, distance
  formatting, timeline state rendering, token-refresh wrapper (401 → refresh → retry → logout).
- **E2E (Maestro):** happy path register → verify → list book → search → request →
  accept → propose meetup → confirm → complete → rate; plus: permission-denied location
  flow, offline launch renders cached list.
- **Manual device matrix per release:** low-end Android (API 26), recent Android, iPhone —
  map performance, deep links (Google/Yandex/Apple), push delivery, dark mode, Turkish locale.

## Load & Performance

- k6 against staging seeded with 100k books / 10k users: search p95 < 500 ms @ 50 RPS;
  WS: 1k concurrent chat connections, message delivery p95 < 300 ms.

## Release QA Checklist (manual, every release)

The Istanbul scenario end-to-end on two physical devices:
1. User A (Kadıköy) lists a book with a GPS-tagged photo → photo EXIF verified stripped.
2. User B (Üsküdar) finds it at "~3 km", requests; A accepts; chat works both ways.
3. B proposes a café via autocomplete; A sees warning-free confirmation; both get reminders.
4. "Open in maps" works in Google and Yandex; trusted-contact share produces correct text.
5. Both complete; double-blind ratings reveal after both submit.
6. B blocks A → A's books vanish from B's search; A's messages stop arriving.
7. B requests data export (arrives) and deletes account (profile anonymized for A).

## CI Gates (every PR)

ruff + mypy + eslint + tsc · backend tests incl. security suite · `alembic check` ·
mobile jest · `pip-audit` + `bandit` · coverage ≥ 80% on `backend/app/modules/`.
