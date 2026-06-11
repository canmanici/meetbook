# MeetBook — Master Plan (v2, Security-First)

> **Who this document is for:** every developer on the project, especially if you are new.
> Read this file top to bottom once. Then use the `docs/` folder as your reference while building.
> Rule of thumb: **this file tells you the "why"; the docs tell you the "how".**

---

## 1. What We Are Building and Why

MeetBook is a mobile app for Turkey where people exchange physical books with each other.
Two strangers find each other through books, agree on a **real, physical meetup at a safe public
place**, meet, swap books, and rate each other.

This is **not a simple CRUD app**. It is a **location-aware, trust-critical platform**.
Three facts shape every decision in this plan:

1. **Strangers meet in person.** Safety and trust features are core product features,
   not nice-to-haves. If we get this wrong, someone can get hurt.
2. **Real GPS data is involved.** Location data is among the most sensitive personal data
   that exists. Turkey's data-protection law (**KVKK**) applies to us, and so does basic ethics.
3. **Geospatial queries are the heart of the app.** "Books within 5 km", "midpoint between
   two users", "is this point inside Turkey" — these need a real spatial database (PostGIS).

**The mindset we expect from every developer:** before writing any code that touches
location, identity, or messaging, ask yourself — *"how could a bad actor abuse this?"*
If you can think of an abuse, the feature is not done until the abuse is handled.

### What a successful exchange looks like (the core loop)

1. Ayşe in Kadıköy lists a book she finished.
2. Mehmet, 3 km away, finds it by searching nearby books.
3. Mehmet sends an exchange request with a short message.
4. Ayşe accepts. A private chat opens between them.
5. One of them proposes a meetup: a café found via place search, Saturday 14:00.
6. The other confirms. Both get reminders, a safety sheet, and an "open in maps" button.
7. They meet, swap books, both mark the exchange completed.
8. Ratings unlock. Both rate each other. Trust scores grow.

Every module in this plan exists to serve one step of that loop.

---

## 2. Threat Model — Read This Before Writing Any Code

We design against concrete attackers, not abstract "security". Each threat below maps to
defenses that are **requirements**, not suggestions. Full details: `docs/SECURITY_AND_PRIVACY.md`.

| Threat | What they try | Our defense (built into the plan) |
|---|---|---|
| **Stalker** | Uses book search repeatedly to triangulate where someone lives | Exact book/user coordinates are **never** sent to other users. We store the true point privately and expose only a blurred point (snapped to ~1 km grid) and a rounded distance ("~3 km away"). Search is rate-limited; repeated radius-probing around one target is detected. |
| **Predator** | Lures a victim to an unsafe or isolated meetup spot | Meetup points are validated as **public POIs** (café, library, mall, station…) via the Places API. Manual pins in residential areas trigger warnings both users must acknowledge. Safety guidelines are shown before every confirmed meetup. Users can share meetup details with a trusted contact. |
| **Account thief** | Credential stuffing, stolen tokens | Argon2id password hashing; login rate-limited with backoff; 15-minute JWT access tokens; **rotating refresh tokens with reuse detection**; tokens stored in Expo SecureStore (never AsyncStorage). |
| **Scammer** | Fake books, no-shows, throwaway accounts | Phone verification (SMS OTP) required before the first exchange request. Ratings unlock only after **both** users confirm completion. New accounts have limits (max active listings/requests). Report & block everywhere. |
| **Data thief** | Dumps user/location data through the API | Object-level authorization on **every** endpoint (tested: user A requesting user B's resources gets 404). Location history auto-deleted after 30 days. API responses use explicit Pydantic schemas — never raw ORM models. No PII in logs. |
| **Spammer** | Mass exchange requests, chat spam | Per-user rate limits on requests and messages. Chat only exists inside an accepted exchange. Blocking a user silences them instantly. |

**Security principles (memorize these):**

- **Never trust client input.** Re-validate coordinates, ownership, and status transitions on the server, always.
- **Deny by default.** An endpoint without an explicit permission check is a bug.
- **Least privilege.** Code and users get only the access they need.
- **Defense in depth.** One broken layer must not mean total compromise.
- **Log security events** (failed logins, blocks, reports, token reuse) — but never log PII or tokens.

---

## 3. Final Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Mobile | React Native + Expo (TypeScript), Expo Router | One codebase for iOS + Android, OTA updates, EAS builds |
| Mobile data/state | TanStack Query (server state) + Zustand (UI state); react-hook-form + zod for forms | Clear separation: server cache vs. local UI state |
| Backend | **FastAPI, Python 3.14, managed with `uv`** | Async, automatic OpenAPI docs, Pydantic validation built in |
| ORM / migrations | SQLAlchemy 2 (async) + **GeoAlchemy2**, Alembic | GeoAlchemy2 gives us PostGIS types inside SQLAlchemy |
| Validation | Pydantic v2 | Native to FastAPI (backend does **not** use Zod/Prisma — those are Node tools) |
| Database | PostgreSQL 16 + PostGIS 3 | Real `geography` queries with GiST spatial indexes |
| Cache / rate-limit / pub-sub | Redis | Refresh-token denylist, rate limiting, chat fan-out |
| Realtime chat | FastAPI native WebSockets + Redis pub/sub | No Socket.IO dependency needed |
| Auth | JWT access (PyJWT) + opaque rotating refresh tokens in DB; Argon2id via `argon2-cffi` | Industry standard + refresh-reuse detection |
| Place search | Google Places API, **proxied through our backend only** | Best Turkey coverage; the API key never ships inside the app; Redis caching controls cost |
| Map deep links | Google Maps / Yandex Maps / Apple Maps via `expo-linking` | Users open the meetup point in whichever map app they have |
| Images | S3-compatible object storage, presigned upload URLs, **server-side EXIF strip + re-encode** | Photo EXIF can contain GPS coordinates — stripping it is a security requirement |
| Push | Expo Push Notifications | Free, integrated with Expo |
| Monitoring | Sentry (mobile + backend), structured JSON logs | |
| CI | GitHub Actions: lint, type-check, tests, migration check on every PR | |

Details and rationale: `docs/TECHNICAL_ARCHITECTURE.md`.

---

## 4. Backend Architecture (modular monolith)

One FastAPI application with strict module boundaries. Microservices are premature for this
stage; a well-bounded monolith can be split later if ever needed.

```
backend/app/
  core/             config, security (JWT, hashing), rate_limit, shared dependencies
  modules/
    auth/           register, login, refresh rotation, phone/email verification
    users/          profile, avatar, blocks, devices
    books/          listings, photos, ISBN lookup, availability
    location/       geo utilities, Turkey geofence, coordinate blurring, nearby search
    places/         Google Places proxy + cache, POI safety validation
    exchanges/      exchange request lifecycle (state machine)
    meetups/        meetup proposal/confirmation, safety validation, scheduling
    chat/           WebSocket endpoint, messages, read receipts
    ratings/        reviews and rating aggregates
    reports/        reports, blocks, moderation queue
    admin/          moderation dashboard API
    notifications/  push + in-app notifications
  workers/          background jobs: location TTL cleanup, meetup reminders, image processing
```

Each module follows the same internal layout: `router.py` (HTTP), `service.py` (business
rules), `repository.py` (DB access), `schemas.py` (Pydantic I/O), `models.py` (SQLAlchemy).
**Routers never touch the database directly** — they call services.

### Exchange state machine (enforced server-side)

```
pending ──► accepted ──► meetup_proposed ──► meetup_confirmed ──► completion_pending ──► completed
   │            │                                                  (one user marked)      (other confirmed,
   ├─► rejected └─► cancelled (either side, before completion)                             ratings unlock)
   └─► cancelled
```

Any transition not drawn above returns HTTP 409. Requests untouched for 14 days auto-expire.
Never let the client tell you the new status directly — expose explicit actions
(`/accept`, `/reject`, `/cancel`, `/complete`) and compute the status on the server.

---

## 5. Data Model (summary)

Full DDL with PostGIS types and indexes: `docs/DATABASE_SCHEMA.md`.

**Golden rule:** every geographic column is `geography(Point, 4326)` with a GiST index.
Raw `latitude` / `longitude` float columns can't use spatial indexes — lat/lon appear only
as API input/output fields, never as the storage format.

Key tables and the important decisions baked into them:

- `users` — profile + `phone_verified_at`, `email_verified_at`, `status`, `last_active_at`.
  Soft delete: KVKK erasure means we anonymize PII but keep the exchange skeleton so the
  *other* party's history stays intact.
- `user_credentials` — password hash lives in its own table so it is never accidentally
  selected or serialized with the user.
- `refresh_tokens` — stores a *hash* of the token, plus `family_id` for rotation/reuse
  detection, device info, `revoked_at`.
- `books` — **two** location columns: `location` (true point, never exposed via API) and
  `public_location` (blurred to ~1 km). Plus condition/language/categories and an ordered
  photos table (EXIF-stripped images only).
- `user_locations` — temporary GPS fixes; a worker deletes rows older than 30 days (KVKK data minimization).
- `exchange_requests` — lifecycle table + `expires_at`, `completion_marked_by`.
- `meetup_places` — proposed/confirmed meetup point + `place_category`,
  `validation_status` (auto-validated public POI vs. manual pin), and `scheduled_at`
  (a meetup needs a *time*, not just a place).
- `messages` — chat content, length-limited, `deleted_at` for soft delete.
- `ratings` — unique `(exchange_request_id, rated_by)`. **Double-blind:** ratings become
  visible only after both sides submit, or after 14 days — this prevents retaliation ratings.
- `blocks`, `reports` — reports point at a user/book/message/place, with reason, moderator notes, status.
- `audit_log` — security events (no PII).

---

## 6. Security Specification (the checklist you code against)

Full version with explanations: `docs/SECURITY_AND_PRIVACY.md`. Summary:

**Auth**
- Argon2id for passwords. Never MD5/SHA/plain bcrypt-with-low-cost.
- Login: max 5 attempts / 15 min per account+IP, exponential backoff, generic error
  messages (never reveal whether an email exists).
- Access JWT lifetime 15 minutes. Refresh tokens are opaque, stored hashed, **rotated on
  every use**; replaying an old refresh token revokes the entire token family.
- Password reset tokens: single-use, 15-minute expiry, stored hashed.
- Phone verification (SMS OTP) required before creating a first exchange request.

**API**
- HTTPS everywhere. Pydantic schemas on every request *and* response.
- Every service method checks ownership explicitly (`book.owner_id == current_user.id`).
- Return **404, not 403**, for resources a user shouldn't know exist.
- Redis sliding-window rate limits: global and per-route. Pagination is always capped.
- File uploads: validate magic bytes (not just extension), enforce size limits, re-encode
  every image server-side (this also strips EXIF GPS data).

**Location privacy (the most important section)**
1. Book search computes distance from the true point on the server but returns only the
   blurred point and a distance rounded to 0.5 km.
2. A user's own home/default location never appears in any other user's API response. Ever.
3. Meetup midpoint suggestions are computed server-side without revealing either party's location.
4. Location history: 30-day TTL, plus immediate user-triggered deletion.
5. KVKK compliance: consent screen at registration, in-app data export, account deletion = PII anonymization.

**Chat**
- WebSocket authenticates via a short-lived one-time ticket fetched over HTTPS
  (never put a JWT in a query string — query strings end up in server logs).
- Chat membership is re-checked on connect **and** on every message.
- Blocking silences delivery instantly. Reporting a message snapshots its content for moderators.

**Meetup safety (product-level security)**
- Curated safe-place categories, auto-validated against Places API types.
- Manual pins in residential areas → warning that both users must acknowledge.
- Pre-meetup safety sheet (public place, daylight, tell a friend).
- "Share meetup with a trusted contact" via the system share sheet.
- Optional post-meetup check-in ("Did everything go OK?") feeding the trust system.

---

## 7. Feature Set

Everything from the original concept, plus the additions marked **(new)**:

**Books & discovery**
- List a book with photos, condition, category, language.
- ISBN barcode scan via `expo-camera` → autofill from Open Library / Google Books **(new)**.
- Search nearby books with filters (category, language, condition, distance).
- Map view of nearby books with blurred pins **(new)**.
- Wishlist: "notify me when this book appears nearby" **(new)**.
- Favorites **(new)**. "Swap suggestions": you have what they want and vice versa **(new)**.

**Trust & safety**
- Verification badges (phone/email). Profile stats: completed exchanges, response rate **(new)**.
- Double-blind ratings with comment **(new mechanics)**.
- Report & block available everywhere a user or content appears.
- New-account limits to slow down throwaway abuse **(new)**.

**Meetup**
- Map picker: drag pin, tap-to-place, place autocomplete, suggested safe places nearby.
- Meetup **time** scheduling + push reminders 24 h and 1 h before **(new)**.
- Reschedule / cancel flow with notifications **(new)**.
- Open in Google Maps → Yandex Maps → Apple Maps (deep links) + copy-address fallback.
- Midpoint suggestion listing 3–5 safe POIs between the two users **(new)**.

**Quality of life**
- Dark mode. Turkish + English i18n, Turkish default **(new)**.
- Offline-tolerant lists (TanStack Query cache). In-app notification center **(new)**.

**Admin & moderation (new module)**
- Web moderation dashboard: report queue, user suspension, listing takedown,
  meetup-place blocklist, basic metrics.

---

## 8. Design System & UX

Full reference: `docs/DESIGN_SYSTEM.md`. The essentials:

- **Foundations first:** 4-pt spacing grid; type scale 12/14/16/20/24/32; radius tokens;
  light + dark palettes with WCAG AA contrast; one icon set (Lucide RN).
- **Components before screens:** Button, Input, Card, Avatar, Badge, Sheet, MapPin,
  EmptyState, Skeleton are built in Phase 2 so every screen *composes* instead of improvising.
- **Tone:** warm, literary, trustworthy. Books are emotional objects; the app should feel
  personal — but never exposing (neighborhood-level location at most).
- **Each key screen has one job:**
  - Home: "books near me" (list/map toggle).
  - Book detail: build enough trust to send a request.
  - Exchange detail: a **single timeline** of the whole lifecycle (request → chat → meetup
    → completion → rating) so users never hunt across tabs.
  - Meetup picker: full-screen map, draggable pin, search bar, "suggested safe places"
    chips, inline validation feedback.
- Loading states are skeletons (never bare spinners on lists). Every list has a designed
  empty state with a call to action. Error messages are human: "Couldn't reach the server — pull to retry."
- Accessibility: touch targets ≥ 44 pt, labels on all interactive elements, dynamic type tolerated.

---

## 9. API Surface (summary)

Endpoint-by-endpoint spec: `docs/BACKEND_API_PLAN.md`. All under `/api/v1`, OpenAPI
auto-generated, mobile API client generated from the OpenAPI spec.

- `/auth` — register, login, refresh, logout, verify-phone, password-reset
- `/users` — me (GET/PATCH), avatar, `{id}` public profile, blocks
- `/books` — CRUD, photos (presigned upload), search (returns **blurred** locations), `isbn/{code}`
- `/exchanges` — create, list sent/received, `{id}`, accept, reject, cancel, complete, confirm-completion
- `/exchanges/{id}/meetup` — propose, accept, reject, suggestions (midpoint POIs)
- `/places` — autocomplete, details, nearby (all proxied + cached server-side)
- `/exchanges/{id}/chat` — history via REST; live messages via `/ws/chat`
- `/ratings`, `/reports`, `/notifications`, `/admin/*`

---

## 10. Roadmap — Phases with Definitions of Done

Detailed version: `docs/MOBILE_APP_ROADMAP.md`. A phase is finished only when its
**Definition of Done (DoD)** can be demonstrated, not merely claimed.

| # | Phase (weeks) | Definition of Done |
|---|---|---|
| 0 | Foundations (0–1) | `docker compose up` boots Postgres+PostGIS+Redis; backend & Expo app run; CI green |
| 1 | Auth & security core (1–3) | Auth test suite passes **including attack tests**: replayed refresh token revokes its family; 6th login attempt is blocked |
| 2 | Design system + app shell (2–4, parallel) | Component gallery screen exists; login/register work against the real API; tokens in SecureStore |
| 3 | Books & discovery (4–7) | Two test users in Istanbul see each other's books at correct rounded distance; tests assert true coordinates never appear in API responses |
| 4 | Exchange lifecycle (7–9) | State-machine tests cover every legal **and illegal** transition; self-requests and duplicates rejected |
| 5 | Meetup module (9–12) | Full QA scenario: pick a café via search and via pin drag; a point outside Turkey is rejected server-side |
| 6 | Chat & notifications (12–14) | Two physical devices chat in real time; blocking silences instantly; reminders fire |
| 7 | Ratings, reports, admin (14–16) | Rating is impossible before completion (tested); a report appears in the admin queue |
| 8 | Hardening & beta (16–18) | Security checklist pass; scripted "user A reads user B's everything" authz suite finds zero leaks; Sentry live; KVKK export/delete flows work; beta on TestFlight / Play internal |
| 9 | Launch (18+) | Production builds, store listings, deployed backend with HTTPS, monitoring + Google Places cost alerts |

---

## 11. Testing & QA

Details: `docs/TESTING_QA_PLAN.md`.

- **Backend:** pytest + httpx; tests run against a **real PostGIS** database
  (testcontainers) because geospatial SQL cannot be faithfully mocked. Coverage gate on
  `modules/`. The **security test suite is mandatory**: authorization matrix, rate limits,
  state machine, location-leak assertions.
- **Mobile:** Jest + React Native Testing Library for logic and components; Maestro for
  E2E happy paths (register → list book → request → meetup → complete → rate).
- The Istanbul QA scenario from §1 is both an automated E2E test and a manual release checklist.

---

## 12. Documentation Map

| File | Contents |
|---|---|
| `docs/PRODUCT_REQUIREMENTS.md` | Vision, personas, user roles, features, flows |
| `docs/SECURITY_AND_PRIVACY.md` | Threat model, full security spec, KVKK compliance |
| `docs/TECHNICAL_ARCHITECTURE.md` | Stack rationale, module design, state machine |
| `docs/DATABASE_SCHEMA.md` | Full schema with PostGIS DDL and indexes |
| `docs/BACKEND_API_PLAN.md` | Endpoint-by-endpoint API specification |
| `docs/LOCATION_AND_MAPS_PLAN.md` | Blurring, Turkey geofence, Places proxy, deep links |
| `docs/DESIGN_SYSTEM.md` | Tokens, components, screen specs |
| `docs/MOBILE_APP_ROADMAP.md` | Phase-by-phase roadmap with DoD checklists |
| `docs/TESTING_QA_PLAN.md` | Test strategy, security tests, QA scenarios |
| `docs/DEPLOYMENT_PLAN.md` | Infrastructure, EAS, monitoring, cost controls |

---

## Key Decisions (one-line summaries)

- Custom backend (FastAPI + Python), **not** Supabase/Firebase — we need serious geospatial and realtime logic.
- PostgreSQL + PostGIS with `geography` columns — real spatial indexes, not float math.
- React Native + Expo + TypeScript on mobile.
- Google Places API as primary place source, **always proxied through our backend**.
- Map deep links for Google / Yandex / Apple Maps; copy-address as universal fallback.
- Meetup location & safety are first-class features.
- Security and KVKK privacy are requirements with tests, not a final-phase cleanup.
