# MeetBook — Anchored Summary

## Goal
- Build and maintain MeetBook admin panel and backend infrastructure

## Constraints & Preferences
- Vanilla JS only (no React/Vue/libraries) for admin UI
- Docker-based dev environment (docker-compose with hot reload)
- Python 3.14 with `uuid.uuid7()` for primary keys
- Turkish UI language for admin panel
- PostgreSQL with PostGIS (via postgis/postgis:16-3.4)
- User wants "maximum detailed, maximum featured" admin panel — "ocean, not water"

## Progress
### Done
- Graphify installed (v0.9.4), graph built (3740 nodes, 7219 edges, 271 communities) and integrated with OpenCode
- Docker volume mount for `admin/` directory in docker-compose files
- UUID v4 → UUID v7 migration completed across all model files, code files, and test files
- `backend/app/core/uuid_utils.py` created with `new_uuid = uuid.uuid7` re-export
- Login `relation "users" does not exist` **FIXED** — root cause: WatchFiles reloader watched `/app/.venv/`, detected pytest files, triggered full reloader restart which re-ran `start_app.py`, causing recovery path to stamp base + upgrade head while tables were already present → tables lost but alembic_version stayed at head
- **Fix applied:** `reload_excludes` added to `uvicorn.run()` in `start_app.py` (excludes `.venv`, `__pycache__`, `*.pyc`, `.git`, `.pytest_cache`)
- Database tables recreated via `alembic stamp base && alembic upgrade head`
- Database re-seeded (dev seed users — see backend/scripts/seed.py; never reuse dev passwords in prod)
- **7 backend metrics endpoints** built (50+ real KPIs):
  - `GET /admin/metrics/overview` — 40+ KPIs across users, books, exchanges, reports, engagement, trust, system
  - `GET /admin/metrics/trends?days=30` — 8 time-series arrays (signups, DAU, WAU, exchanges created/completed, reports, books, favorites)
  - `GET /admin/metrics/books` — category/condition/language distribution, top viewed/favorited
  - `GET /admin/metrics/exchanges` — by-status breakdown, success rate, avg completion time, top requesters/owners
  - `GET /admin/metrics/users` — by-status breakdown, admin count, verification rates, users with books
  - `GET /admin/metrics/trust` — bans, suspensions, report resolution rate, top reported users, recent mod actions
  - `GET /admin/metrics/system` — DB size, connections, cache hit ratio, crash reports, audit log stats
- `backend/app/modules/admin/metrics_service.py` created (350 lines, 12 query methods)
- `backend/app/modules/admin/service.py` — added `global_search()` method
- `GET /admin/search?q=...` endpoint added
- Admin router updated to ~35 routes (7 metrics + search + review/dismiss report aliases)
- `backend/app/modules/admin/user_activity.py` — per-user activity module (3 endpoints):
  - `GET /users/{id}/activity/overview` — message_count, call_count, call_total_duration_minutes, book_count, exchange_count
  - `GET /users/{id}/activity/messages?limit=N` — all user messages across chats with grouped by_chat_id stats
  - `GET /users/{id}/activity/calls?limit=N` — call timeline with by_kind/by_status aggregation + total_duration_minutes
- `AdminUserListItem` schema extended with `book_count`, `message_count`, `exchange_count` — batch-fetched via aggregate queries (no N+1)
- **Full ocean-level admin panel** (`admin/index.html`, 3320 lines, 209KB):
  - Custom CSS ocean theme (~30KB): glass morphism, gradients, dark/light theme, responsive, chart components (SVG line/area, donut, gauge, sparkline, horizontal bar), timeline, pagination, modal system, toast system, skeleton loading states
  - HTML structure: sidebar with 9 nav items (CEO Dashboard, Derin Analiz, Raporlar, Kullanıcılar, Kitaplar, Takaslar, Engellenen Yerler, Denetim Kaydı, Sistem Sağlığı), 9 page templates, 6 modal templates, login page, toast container
  - JavaScript engine (~80KB): API client with auth, state management, SVG chart engine (5 chart types), dashboard loader with 16 KPI cards + trend chart + user donut + book bars + activity timeline + system health gauges + 60s auto-refresh, analytics page with 4 tabs, paginated CRUD pages (reports, users, books, exchanges, blocked-places, audit-log, system health), modal system, confirmation dialogs, toast notifications, CSV export, global search, keyboard shortcuts, responsive sidebar, theme toggle
  - **User detail modal** (860px wide): 3-tab interface — Profil tab (detail grid with stats), Mesajlar tab (grouped by conversation with conversation headers, system message compaction ×N, bubble/user layout), Çağrılar tab (by_kind/by_status stat chips + call timeline with status colors)
  - **Users page** redesign: flat table → glassmorphic card grid with stats bar (total/active/suspended/banned/admin/messages/books), toolbar with glass search with clear button + status dropdown filter, per-user cards with gradient avatar, activity chips (mesaj/kitap/takas/puan/durum), action buttons (Detay/Askıya Al/Banla/Geri Getir), inline pagination with total count
  - **ALL remaining table pages → card grid upgrade (5 pages):**
    - **Kitaplar** — gradient book cover, title/author, category/condition chiplearı, status badge, view/favorite counts, Detay/Kaldır actions
    - **Takaslar** — status-colored avatar, exchange/kitap ID, requester/owner chips, expiry info, Detay action
    - **Raporlar** — report ID, reporter UUID, target type/ID, reason chip, status badge, İncele/Çöz/Reddet/✉️ actions, moderator tracking
    - **Engellenen Yerler** — place ID, coordinates chip, reason, Sil action
    - **Denetim Kaydı** — single-column card stream with colored event dot, user email, IP, metadata detail chip, styled per event type
  - Shared `.crud-grid` / `.data-card` CSS system (reusable across all card pages)
  - Event listener guards added to ALL paginated pages (prevents accumulation)
  - Pagination upgraded to inline format with total count (matching users page)
- Bug fix: removed duplicate `escHtml` function (DOM-based one kept)
- Bug fix: event listener leak in users page — `usersListenersAttached` guard prevents duplicate input/change handlers
- Bug fix: "Ger Getir" → "Geri Getir" typo in user action labels
- Bug fix: `loadReportsPagePaginated` — removed dead placeholder render that created unnecessary DOM flicker + literal "...same card template..." text
- All backend endpoints verified 200 OK with real data (8 books, 3 exchanges, 1 report, 131 audit logs)
- Graph updated

### In Progress
- (none)

### Recently Done (non-admin)
- Removed camera button (ISBN scan) and filter button from home screen search bar (`mobile/src/app/tabs/home.tsx`) — both were UI clutter in the search row; filter still accessible via RightControls floating button
- Cleaned up unused styles (`cameraCircle`, `filterBadge`, `filterBadgeText`)

### Blocked
- (none)

## WebRTC Calls + TURN Infrastructure (July 2026)
1:1 voice & video calls between exchange participants, end-to-end:
- **Signaling** rides the existing chat WebSocket (`/ws/chat`): message type `call` with events `offer|answer|ice|end|reject|cancel|busy`. Backend (`chat/service.py::handle_call`) validates participant + block state and relays SDP/ICE — it never inspects media. Terminating events with a `log` object persist a `system` message (`extra.action = 'call_log'`, kind/status/duration) as in-thread call history; offline callee gets a missed-call push.
- **TURN**: `coturn` container in both compose files, `network_mode: host` (relay port range through docker-proxy would melt the host). Prod: quotas (`user-quota=12`, `total-quota=1200`, `max-bps=1.5M`) and `denied-peer-ip` for ALL private ranges (prevents relay-based scanning of the docker network). Firewall must allow `3478/udp+tcp` and `49160-49600/udp`.
- **Auth is ephemeral HMAC** (coturn `use-auth-secret` / REST-API scheme): NO static TURN password anywhere. `GET /chat/turn-credentials` (authed) mints `username = "<unix_expiry>:<user_id>"`, `credential = b64(HMAC-SHA1(TURN_SECRET, username))`, TTL 1h. Cracking the APK yields nothing; a stolen credential dies within the hour. `TURN_SECRET` is shared backend↔coturn via env (Dokploy env vars: `TURN_SECRET`, `TURN_HOST`).
- **Mobile**: `react-native-webrtc` + `@config-plugins/react-native-webrtc` + `react-native-incall-manager` — native modules, ONLY in dev-client/release builds; all access via lazy loader `mobile/src/lib/webrtc.ts` (Expo Go/web/Jest degrade gracefully, call UI hides). Call state machine in `stores/call-store.ts` (ring timeout 30s, busy handling, ICE buffering, TURN cred caching); full-screen UI `app/call.tsx`; global `components/call-manager.tsx` in root layout auto-navigates on incoming calls.
- **P2P vs relay**: ICE tries STUN P2P first (~80-85% of pairs connect directly, zero server cost); two-sided CGNAT automatically falls back to the coturn relay (~0.25 Mbps/audio call, ~4 Mbps/video call of server bandwidth).
- After changing the native deps or app.json plugins: rebuild the APK (local gradle toolchain or EAS) — Metro reload is NOT enough.
- **Adaptive quality**: call-store runs a 3s `getStats()` monitor during active calls — packet loss + RTT → `networkQuality` (good/fair/poor) for the UI signal bars, and in AUTO mode steps the video encoder ceiling (250k/800k/2.5M via `RTCRtpSender.setParameters`) down fast (2 bad samples) / up slow (5 good samples). User can pin Düşük/Orta/Yüksek from the call screen.
- **Server firewall** (bare VDS, no provider panel): if `ufw` is inactive everything is open and TURN just works. If enabling ufw: allow 22, 80, 443, 3478 (udp+tcp), 49160:49600/udp. NOTE: Docker-published ports BYPASS ufw (iptables DOCKER chain) — the minio console on host port 9001 is reachable regardless of ufw rules.

## Key Decisions
- **Keep vanilla JS** for admin UI — user explicitly rejected frameworks/libraries
- **Replace `uuid.uuid4` with `uuid.uuid7`** across entire codebase — better B-tree index performance
- **Serve admin panel from backend** (`/admin/index.html` on port 8000) — eliminates CORS issues
- **Use `window.location.hostname`** for API base URL — supports LAN access from any device
- **Centralized `new_uuid` helper** in `uuid_utils.py` for future UUID algorithm changes
- **Exclude `.venv` from WatchFiles** — prevents reloader from detecting site-package changes and triggering destructive full restarts
- **Separate `metrics_service.py`** from existing `service.py` — read-only analytics queries separated from write operations
- **All metrics are real DB queries** — zero mock data, every KPI computed from actual rows
- **JS API client maps parameter names** to match backend schemas (e.g., `skip`→`offset`, `q`→`search`, `available`→`available_only`)
- **User activity split into 3 endpoints** (overview, messages, calls) instead of one big payload — lazy loading per tab, smaller initial payload
- **User list counts batch-fetched** (3 aggregate queries total regardless of page size) instead of N+1 per user
- **Messages grouped by conversation in frontend** — keeps endpoint simple, groups always sorted newest-first
- **Consecutive system messages compacted with ×N badge** — prevents noise from repeated call logs/system events
- **Users page switched from table to cards** — activity chips (mesaj/kitap/takas) don't fit in table columns

## Next Steps
1. Open `http://127.0.0.1:8000/admin/index.html` with Ctrl+F5 hard refresh
2. Test Kullanıcılar page: stats bar numbers, card grid, search/filter, action buttons (Askıya Al/Banla/Detay)
3. Test user detail modal: Profil tab, Mesajlar tab (check conversation grouping + ×N compaction), Çağrılar tab (stats + timeline)
4. Test Derin Analiz tabs, report action buttons, theme toggle persistence, responsive layout

## Critical Context
- Backend runs in Docker on `0.0.0.0:8000`, accessed at `http://127.0.0.1:8000`
- Admin panel accessed at `http://127.0.0.1:8000/admin/index.html`
- Dev mode uses `docker-compose.yml` + `docker-compose.dev.yml` together
- Backend source code is volume-mounted — changes picked up via WatchFiles hot reload
- **Admin login (local dev only):** dev seed users from backend/scripts/seed.py — prod admins come from Dokploy env (ADMIN_EMAILS / SEED_ADMIN_PASSWORD)
- WatchFiles now has `reload_excludes` to prevent `.venv` from triggering restarts
- All API endpoints use `/api/v1/` prefix (e.g., `/api/v1/admin/users`, `/api/v1/auth/login`)
- Browser MUST hard refresh (Ctrl+F5) after admin HTML changes due to aggressive caching
- User detail modal is 860px wide (was 720px) to fit messages + calls tabs
- `loadUserMessages`/`loadUserCalls` have `el.dataset.loaded` guard — must clear when switching users

## Relevant Files
- `admin/index.html`: **Ocean-level admin panel** — 3320 lines, 209KB (CSS + HTML + JS in one file)
- `backend/app/modules/admin/user_activity.py`: Per-user activity endpoints (overview, messages, calls)
- `backend/app/modules/admin/metrics_service.py`: 350 lines, 12 query methods, 50+ real KPIs
- `backend/app/modules/admin/router.py`: ~35 endpoints (7 metrics + search + user activity + report actions + CRUD)
- `backend/app/modules/admin/service.py`: Business logic + `global_search()` + `_user_to_list_item` with counts
- `backend/app/modules/admin/schemas.py`: Metric response models + extended `AdminUserListItem`
- `backend/app/modules/admin/repository.py`: DB queries + batch aggregate user counts
- `backend/scripts/start_app.py`: Updated with `reload_excludes` for uvicorn
- `backend/scripts/seed.py`: Seed script
- `backend/app/routers.py`: Router registration — `user_activity_router` included
- `docker-compose.yml` + `docker-compose.dev.yml`: Volume mounts
- `docker-compose.prod.yml`: Dokploy stack (Traefik labels) + `coturn` TURN relay (host network)
- `backend/app/modules/chat/service.py`: chat WS handlers + `handle_call` WebRTC signaling relay
- `backend/app/modules/chat/router.py`: `GET /chat/turn-credentials` — ephemeral TURN cred minting
- `mobile/src/stores/call-store.ts`: WebRTC call state machine (offer/answer/ICE, timeouts, TURN creds)
- `mobile/src/app/call.tsx` + `mobile/src/components/call-manager.tsx`: call UI + global orchestrator
- `mobile/src/lib/webrtc.ts`: lazy native-module loader + STUN fallback list
