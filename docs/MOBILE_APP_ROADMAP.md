# Roadmap — Phases with Definitions of Done

> A phase is done when its **DoD checklist** can be demonstrated live, not claimed.
> Weeks are estimates for one focused developer + review; phases 2 can run parallel to 1/3.

## Phase 0 — Foundations (week 0–1)
Repo scaffold (backend `uv` project, Expo TS app), `docker-compose.yml`
(postgres+postgis, redis), Alembic wired, CI (ruff, mypy, pytest / eslint, tsc, jest),
pre-commit hooks, `.env.example`.
**DoD:** fresh clone → `docker compose up` + `uv run fastapi dev` + `npx expo start` all
work; CI green on a trivial PR.

## Phase 1 — Auth & security core (week 1–3)
Register/login/refresh/logout with Argon2id + rotating refresh tokens + reuse detection;
login throttling; password reset; SMS OTP phone verification; `get_current_user` /
`get_verified_user` dependencies; audit log; rate-limit middleware.
**DoD:** auth test suite passes **including attack tests**: (a) replayed rotated-out
refresh token revokes the whole family, (b) 6th login attempt in 15 min is rejected,
(c) reset response identical for existing/missing email, (d) suspended user is rejected.

## Phase 2 — Design system + app shell (week 2–4, parallel)
Tokens, all core components, `/__gallery` route, tab navigation, auth screens wired to
the real API, SecureStore token handling, generated OpenAPI client, i18n scaffolding (tr/en).
**DoD:** gallery shows every component in every state; register→verify→login→logout works
on a device against the local backend; tokens absent from AsyncStorage (checked).

## Phase 3 — Books & discovery (week 3–7)
Books CRUD + photos (presigned upload, server re-encode + EXIF strip), ISBN scan +
lookup proxy, PostGIS nearby search with static blur + rounded distances, Home list/map,
filters, wishlist + favorites, wishlist-match worker.
**DoD:** two test users in Istanbul see each other's books at correct rounded distance;
**a test asserts true coordinates never appear in any search/detail response for
non-owners**; an uploaded photo with GPS EXIF comes back stripped (tested).

## Phase 4 — Exchange lifecycle (week 7–9)
State machine service, request create with all guards (self-request, duplicate, blocked
pair, availability, new-account limits), accept/reject/cancel/complete/confirm, expiry
worker, requests UI (sent/received), Exchange detail timeline (without meetup yet).
**DoD:** state-machine test matrix covers every legal **and illegal** transition incl.
wrong-actor attempts; duplicate + self-request rejected; auto-expiry tested with frozen time.

## Phase 5 — Meetup module (week 9–12)
Places proxy (autocomplete/details/nearby + Redis cache), Turkey polygon geofence,
safety-category validation + blocked-places check, midpoint suggestions, meetup picker
screen, propose/accept/reject/reschedule with `scheduled_at`, deep links (Google → Yandex
→ Apple → copy), trusted-contact share, safety sheet.
**DoD:** full flow on device: pick café via search **and** via pin drag; residential pin
requires double acknowledgment; point in Greece rejected server-side (tested); meetup
opens correctly in at least two map apps.

## Phase 6 — Chat & notifications (week 12–14)
WS ticket auth, chat WebSocket + Redis pub/sub, history REST, read receipts, unread
counts, Expo push (new request/accept/message/wishlist), reminder worker (24 h / 1 h),
in-app notification center.
**DoD:** two physical devices chat in real time; block mid-conversation stops delivery
instantly (tested at the WS layer); reminders fire for a near-future meetup.

## Phase 7 — Ratings, reports, admin (week 14–16)
Double-blind ratings + reveal worker + aggregates; report flows with content snapshots;
block UX everywhere; admin web dashboard (reports queue, suspension, takedown,
blocked-places CRUD, metrics).
**DoD:** rating before completion impossible (tested); second rating rejected; ratings
hidden until both submitted (tested); a filed report appears in the admin queue and
resolving it notifies the reporter.

## Phase 8 — Hardening & beta (week 16–18)
Run the full security checklist (security doc §10) against every endpoint; **scripted
authz suite: "user A requests every user-B resource" must yield 404s across the whole
API**; load test search (k6, 100k seeded books, p95 < 500 ms); Sentry both sides; KVKK
export + delete flows; dependency audit; beta via TestFlight / Play internal.
**DoD:** zero criticals open; authz suite green; load target met; 10 beta users complete
a real exchange.

## Phase 9 — Launch (week 18+)
EAS production builds + store listings (TR + EN), production deploy per
`DEPLOYMENT_PLAN.md`, monitoring dashboards, Google Places cost alerts, on-call basics.
**DoD:** app live in both stores; a stranger-to-stranger exchange completes in production;
dashboards show it.

## Working Agreements (junior-dev guardrails)

- One PR per feature slice; PR description links the plan section it implements.
- Every PR: tests for new logic + the security DoD checklist from the security doc.
- Migrations reviewed by a second person. Never edit an applied migration.
- If a task seems to need exposing a true coordinate or skipping the state machine —
  stop and raise it; that's a design conversation, not a workaround.
