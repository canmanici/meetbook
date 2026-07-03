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
- Admin panel (`admin/index.html`) served from backend at `/admin/index.html` (200 OK, 114KB, 1681 lines)
- Docker volume mount for `admin/` directory in docker-compose files
- UUID v4 → UUID v7 migration completed across all model files, code files, and test files
- `backend/app/core/uuid_utils.py` created with `new_uuid = uuid.uuid7` re-export
- Login `relation "users" does not exist` **FIXED** — root cause: WatchFiles reloader watched `/app/.venv/`, detected pytest files, triggered full reloader restart which re-ran `start_app.py`, causing recovery path to stamp base + upgrade head while tables were already present → tables lost but alembic_version stayed at head
- **Fix applied:** `reload_excludes` added to `uvicorn.run()` in `start_app.py` (excludes `.venv`, `__pycache__`, `*.pyc`, `.git`, `.pytest_cache`)
- Database tables recreated via `alembic stamp base && alembic upgrade head`
- Database re-seeded (admin password: `changeme123`, second admin: `canmanici@gmail.com` / `***REMOVED***`)
- **7 new backend metrics endpoints** built (50+ real KPIs):
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
- **Full ocean-level admin panel** (`admin/index.html`, 114KB, 1681 lines):
  - Custom CSS ocean theme (~25KB): glass morphism, gradients, dark theme, responsive, chart components (SVG line/area, donut, gauge, sparkline, horizontal bar), timeline, pagination, modal system, toast system, skeleton loading states
  - HTML structure: sidebar with 9 nav items (CEO Dashboard, Derin Analiz, Raporlar, Kullanıcılar, Kitaplar, Takaslar, Engellenen Yerler, Denetim Kaydı, Sistem Sağlığı), 9 page templates, 6 modal templates, login page, toast container
  - JavaScript engine (~70KB): API client with auth, state management, SVG chart engine (5 chart types: line/area with smooth curves, donut with labels, gauge with thresholds, sparkline, horizontal bar), dashboard loader with 16 KPI cards + trend chart + user donut + book bars + activity timeline + system health gauges + 60s auto-refresh, analytics page with 4 tabs, paginated CRUD pages (reports, users, books, exchanges, blocked-places, audit-log, system health), modal system, confirmation dialogs, toast notifications, CSV export, global search, keyboard shortcuts, responsive sidebar
  - Mapped to actual backend response schemas (field names, parameter names)
- All 13 API endpoints verified → 200 OK with correct data
- Graph updated

### In Progress
- (none — admin panel functional end-to-end)

### Recently Done (non-admin)
- Removed camera button (ISBN scan) and filter button from home screen search bar (`mobile/src/app/tabs/home.tsx`) — both were UI clutter in the search row; filter still accessible via RightControls floating button
- Cleaned up unused styles (`cameraCircle`, `filterBadge`, `filterBadgeText`)

### Blocked
- (none)

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

## Next Steps
- (user-driven — admin panel is complete and functional)

## Critical Context
- Backend runs in Docker on `0.0.0.0:8000`, accessed at `http://127.0.0.1:8000`
- Admin panel accessed at `http://127.0.0.1:8000/admin/index.html`
- Dev mode uses `docker-compose.yml` + `docker-compose.dev.yml` together
- Backend source code is volume-mounted — changes picked up via WatchFiles hot reload
- **Admin password:** `changeme123` (not `admin123`)
- **Second admin:** `canmanici@gmail.com` / `***REMOVED***`
- WatchFiles now has `reload_excludes` to prevent `.venv` from triggering restarts

## Relevant Files
- `admin/index.html`: **Ocean-level admin panel** — 1681 lines, 114KB (CSS + HTML + JS in one file)
- `backend/app/modules/admin/metrics_service.py`: 350 lines, 12 query methods, 50+ real KPIs
- `backend/app/modules/admin/router.py`: ~35 endpoints (7 metrics + search + report actions + CRUD)
- `backend/app/modules/admin/service.py`: Business logic + `global_search()` method
- `backend/app/modules/admin/schemas.py`: 15+ metric response models
- `backend/app/modules/admin/repository.py`: DB queries (233 lines)
- `backend/scripts/start_app.py`: Updated with `reload_excludes` for uvicorn
- `backend/scripts/seed.py`: Seed script (admin: `changeme123`)
- `docker-compose.yml` + `docker-compose.dev.yml`: Volume mounts
