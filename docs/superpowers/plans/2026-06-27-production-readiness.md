# MeetBook Production Readiness Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make MeetBook backend + mobile production-ready with custom crash reporting, database resilience, structured logging, response caching, and UX polish.

**Architecture:** FastAPI backend (Python 3.14, uv-managed) + React Native/Expo mobile (TypeScript, Expo SDK 54). PostgreSQL 16 + PostGIS for spatial queries, Redis for caching/rate-limiting/pub-sub, MinIO for photo storage. Docker Compose dev + Traefik/Dokploy production.

**Tech Stack:** FastAPI + SQLAlchemy Async + Redis + MinIO (backend); TanStack Query + Zustand + MapLibre (mobile); Custom crash reporter (own endpoint); EAS for mobile builds.

---

### Task 1: Crash Reporter — Backend (Database + Endpoint)

**Files:**
- Create: `backend/app/modules/crash_reports/__init__.py`
- Create: `backend/app/modules/crash_reports/models.py`
- Create: `backend/app/modules/crash_reports/schemas.py`
- Create: `backend/app/modules/crash_reports/router.py`
- Modify: `backend/app/main.py` (register router)
- Create: `backend/alembic/versions/XXXX_add_crash_reports.py` (migration)

#### Step 1: Create the SQLAlchemy model

- [ ] Create `backend/app/modules/crash_reports/__init__.py` (empty file)

- [ ] Create `backend/app/modules/crash_reports/models.py`:

```python
"""Crash report model — stores app crashes for debugging."""

import uuid
from datetime import datetime, timezone

from sqlalchemy import Text, String, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class CrashReport(Base):
    __tablename__ = "crash_reports"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    app: Mapped[str] = mapped_column(
        String(20), default="mobile", comment="mobile | backend | admin"
    )
    app_version: Mapped[str | None] = mapped_column(
        String(30), nullable=True, comment="e.g. 1.1.0"
    )
    error_type: Mapped[str | None] = mapped_column(
        String(100), nullable=True, comment="Error.name e.g. TypeError"
    )
    error_message: Mapped[str] = mapped_column(
        Text, comment="Human-readable error description"
    )
    stack_trace: Mapped[str | None] = mapped_column(
        Text, nullable=True, comment="Full JS/Python stack trace"
    )
    breadcrumbs: Mapped[list[dict]] = mapped_column(
        JSONB, default=list, comment="Last N user actions before crash"
    )
    device_info: Mapped[dict] = mapped_column(
        JSONB, default=dict,
        comment='{ platform, os_version, model, memory_mb, ... }'
    )
    screen_name: Mapped[str | None] = mapped_column(
        String(100), nullable=True, comment="Screen the user was on"
    )
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True, comment="Logged-in user (if any)"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        comment="When the crash was reported",
    )
```

#### Step 2: Create Pydantic schemas

- [ ] Create `backend/app/modules/crash_reports/schemas.py`:

```python
"""Pydantic schemas for crash report ingestion and admin views."""

import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class BreadcrumbEntry(BaseModel):
    """A single user action recorded before the crash."""
    action: str  # e.g. "navigate", "api_call", "tap_button"
    label: str   # e.g. "Navigated to /book/123", "GET /auth/me"
    timestamp: str  # ISO 8601
    data: dict | None = None  # optional extra context


class DeviceInfo(BaseModel):
    """Device metadata sent with every crash."""
    platform: str  # "android" | "ios"
    os_version: str
    model: str | None = None
    app_version: str | None = None
    memory_mb: int | None = None
    is_emulator: bool = False


class CrashReportCreate(BaseModel):
    """Payload sent by the mobile app or backend crash handler."""
    app: str = "mobile"
    app_version: str | None = None
    error_type: str | None = None
    error_message: str = Field(..., max_length=5000)
    stack_trace: str | None = Field(None, max_length=20000)
    breadcrumbs: list[BreadcrumbEntry] = Field(default_factory=list, max_length=50)
    device_info: DeviceInfo | None = None
    screen_name: str | None = Field(None, max_length=200)
    user_id: str | None = None  # string because it comes from Expo SecureStore


class CrashReportView(BaseModel):
    """Single crash report returned to admin dashboard."""
    id: uuid.UUID
    app: str
    app_version: str | None
    error_type: str | None
    error_message: str
    stack_trace: str | None
    breadcrumbs: list[dict]
    device_info: dict
    screen_name: str | None
    user_id: uuid.UUID | None
    created_at: datetime

    model_config = {"from_attributes": True}


class CrashReportListResponse(BaseModel):
    """Paginated list of crash reports."""
    items: list[CrashReportView]
    total: int
    page: int
    page_size: int
```

#### Step 3: Create the router (two endpoints)

- [ ] Create `backend/app/modules/crash_reports/router.py`:

```python
"""Crash report endpoints — ingest (public) + admin list/detail."""

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_session
from app.modules.admin.router import router as admin_router
from app.modules.crash_reports.models import CrashReport
from app.modules.crash_reports.schemas import (
    CrashReportCreate,
    CrashReportView,
    CrashReportListResponse,
)
from app.modules.auth.dependencies import get_admin_user
from app.modules.auth.models import User

# ── Public router (no auth — crash can happen logged out) ──────────
crash_router = APIRouter(prefix="/crash-report", tags=["crash"])


@crash_router.post("", status_code=201)
async def report_crash(
    payload: CrashReportCreate,
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Ingest a crash report from mobile app or backend.

    No authentication required — the app may crash during login or
    before the user is authenticated.
    """
    crash = CrashReport(
        app=payload.app,
        app_version=payload.app_version,
        error_type=payload.error_type,
        error_message=payload.error_message,
        stack_trace=payload.stack_trace,
        breadcrumbs=[b.model_dump() for b in payload.breadcrumbs],
        device_info=payload.device_info.model_dump() if payload.device_info else {},
        screen_name=payload.screen_name,
        user_id=uuid.UUID(payload.user_id) if payload.user_id else None,
    )
    session.add(crash)
    await session.commit()
    return {"id": str(crash.id), "ok": True}


# ── Admin endpoints (auth required, attached to existing admin router) ──────────

@admin_router.get("/crash-reports", response_model=CrashReportListResponse)
async def list_crash_reports(
    app: str | None = Query(default=None, description="Filter by app: mobile/backend/admin"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    session: AsyncSession = Depends(get_session),
    admin_user: User = Depends(get_admin_user),
) -> CrashReportListResponse:
    """List crash reports (newest first). Admin only."""
    query = select(CrashReport)
    count_query = select(func.count(CrashReport.id))

    if app:
        query = query.where(CrashReport.app == app)
        count_query = count_query.where(CrashReport.app == app)

    total = (await session.execute(count_query)).scalar() or 0

    items = (
        await session.execute(
            query.order_by(desc(CrashReport.created_at))
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    ).scalars().all()

    return CrashReportListResponse(
        items=[CrashReportView.model_validate(r) for r in items],
        total=total,
        page=page,
        page_size=page_size,
    )


@admin_router.get("/crash-reports/{crash_id}", response_model=CrashReportView)
async def get_crash_report(
    crash_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    admin_user: User = Depends(get_admin_user),
) -> CrashReportView:
    """Get a single crash report with full stack trace. Admin only."""
    result = await session.execute(
        select(CrashReport).where(CrashReport.id == crash_id)
    )
    crash = result.scalar_one_or_none()
    if not crash:
        raise HTTPException(status_code=404, detail="Crash report not found")
    return CrashReportView.model_validate(crash)
```

#### Step 4: Register router in main.py

- [ ] In `backend/app/main.py`, in the `create_app()` function, add after the auth router registration:

```python
# Crash reports (public ingest endpoint + admin view)
from app.modules.crash_reports.router import crash_router
app.include_router(crash_router, prefix="/api/v1")
```

#### Step 5: Create Alembic migration

- [ ] Run:
```bash
cd backend && uv run alembic revision --autogenerate -m "add crash_reports table"
```

- [ ] Verify the generated migration in `backend/alembic/versions/` creates the `crash_reports` table with all columns and the foreign key to users.

- [ ] Run the migration:
```bash
uv run alembic upgrade head
```

#### Step 6: Verify

- [ ] Start backend: `docker compose up -d db backend`
- [ ] Send a test crash:
```bash
curl -X POST http://localhost:8000/api/v1/crash-report \
  -H "Content-Type: application/json" \
  -d '{
    "app": "mobile",
    "app_version": "1.1.0",
    "error_type": "TypeError",
    "error_message": "Cannot read property map of undefined",
    "stack_trace": "at HomeScreen (home.tsx:897:42)\n...",
    "breadcrumbs": [
      {"action": "navigate", "label": "Navigated to /tabs/home", "timestamp": "2026-06-27T10:00:00Z", "data": null}
    ],
    "device_info": {
      "platform": "android",
      "os_version": "14",
      "model": "samsung SM-S918B",
      "app_version": "1.1.0"
    },
    "screen_name": "tabs/home",
    "user_id": null
  }'
```

Expected: `{"id":"...","ok":true}`

- [ ] Check DB:
```bash
docker compose exec db psql -U meetbook -d meetbook -c "SELECT id, error_type, error_message FROM crash_reports;"
```

---

### Task 2: Crash Reporter — Mobile (Global Error Handler + Breadcrumbs)

**Files:**
- Create: `mobile/src/lib/crash-reporter.ts`
- Modify: `mobile/src/app/_layout.tsx` (initialize reporter)
- Modify: `mobile/src/components/app-error-boundary.tsx` (wire in)

#### Step 1: Create the crash reporter module

- [ ] Create `mobile/src/lib/crash-reporter.ts`:

```typescript
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import AsyncStorage from '@react-native-async-storage/async-storage';

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? '';
const CRASH_ENDPOINT = `${API_URL}/crash-report`;
const PENDING_CRASHES_KEY = 'pending_crashes';

interface Breadcrumb {
  action: string;
  label: string;
  timestamp: string;
  data?: Record<string, unknown> | null;
}

interface DeviceInfo {
  platform: string;
  os_version: string;
  model: string | null;
  app_version: string | null;
  memory_mb: number | null;
  is_emulator: boolean;
}

interface CrashPayload {
  app: string;
  app_version: string | null;
  error_type: string;
  error_message: string;
  stack_trace: string | null;
  breadcrumbs: Breadcrumb[];
  device_info: DeviceInfo | null;
  screen_name: string | null;
  user_id: string | null;
}

class CrashReporter {
  private breadcrumbs: Breadcrumb[] = [];
  private currentScreen: string | null = null;
  private currentUserId: string | null = null;
  private initialized = false;
  private readonly MAX_BREADCRUMBS = 50;

  /** Record user actions for crash context. Call from navigation and API wrappers. */
  addBreadcrumb(action: string, label: string, data?: Record<string, unknown>) {
    if (!this.initialized) return;
    this.breadcrumbs.push({
      action,
      label,
      timestamp: new Date().toISOString(),
      data: data ?? null,
    });
    // Keep only last N breadcrumbs
    if (this.breadcrumbs.length > this.MAX_BREADCRUMBS) {
      this.breadcrumbs = this.breadcrumbs.slice(-this.MAX_BREADCRUMBS);
    }
  }

  /** Set the current screen name. Call from navigation listener. */
  setCurrentScreen(name: string) {
    if (!this.initialized) return;
    this.currentScreen = name;
    this.addBreadcrumb('navigate', `Screen: ${name}`);
  }

  /** Set the current user. Call after successful login / from auth state. */
  setUser(userId: string | null) {
    this.currentUserId = userId;
  }

  /** Build device metadata once at init. */
  private buildDeviceInfo(): DeviceInfo {
    return {
      platform: Platform.OS,
      os_version: String(Platform.Version),
      model: Device.modelName ?? null,
      app_version: Constants.expoConfig?.version ?? null,
      memory_mb: null, // not available in JS; native module could expose
      is_emulator: !Device.isDevice,
    };
  }

  /** Send a crash payload to the backend. Best-effort — never throws. */
  private async send(payload: CrashPayload): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const res = await fetch(CRASH_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      return res.ok;
    } catch {
      return false;
    }
  }

  /** Save crash to AsyncStorage for later retry. */
  private async savePending(payload: CrashPayload) {
    try {
      const raw = await AsyncStorage.getItem(PENDING_CRASHES_KEY);
      const pending: CrashPayload[] = raw ? JSON.parse(raw) : [];
      pending.push(payload);
      // Keep max 10 pending crashes
      await AsyncStorage.setItem(
        PENDING_CRASHES_KEY,
        JSON.stringify(pending.slice(-10)),
      );
    } catch {
      // silently fail — storage might be unavailable
    }
  }

  /** Retry sending any crashes saved for later. */
  async flushPending() {
    try {
      const raw = await AsyncStorage.getItem(PENDING_CRASHES_KEY);
      if (!raw) return;
      const pending: CrashPayload[] = JSON.parse(raw);
      const remaining: CrashPayload[] = [];
      for (const crash of pending) {
        const sent = await this.send(crash);
        if (!sent) remaining.push(crash);
      }
      if (remaining.length === 0) {
        await AsyncStorage.removeItem(PENDING_CRASHES_KEY);
      } else {
        await AsyncStorage.setItem(PENDING_CRASHES_KEY, JSON.stringify(remaining));
      }
    } catch {
      // silently fail
    }
  }

  /** Report a caught error. Use in try-catch blocks and error boundaries. */
  async captureError(error: unknown, context?: string) {
    if (!this.initialized) return;

    const err = error instanceof Error ? error : new Error(String(error));
    const payload: CrashPayload = {
      app: 'mobile',
      app_version: Constants.expoConfig?.version ?? null,
      error_type: context ?? err.name,
      error_message: err.message || String(error),
      stack_trace: err.stack ?? null,
      breadcrumbs: [...this.breadcrumbs],
      device_info: this.buildDeviceInfo(),
      screen_name: this.currentScreen,
      user_id: this.currentUserId,
    };

    const sent = await this.send(payload);
    if (!sent) {
      await this.savePending(payload);
    }
  }

  /** Initialize: hook into global error handler + set up. */
  initialize() {
    if (this.initialized) return;
    this.initialized = true;

    // Capture unhandled JS errors
    const originalHandler = ErrorUtils.getGlobalHandler();
    ErrorUtils.setGlobalHandler((error: Error, isFatal?: boolean) => {
      // Report crash BEFORE the app potentially dies
      this.captureError(error, isFatal ? 'UnhandledFatal' : 'Unhandled');
      // Call the original handler (RedBox in dev, crash in prod)
      if (originalHandler) {
        originalHandler(error, isFatal);
      }
    });

    // Flush any crashes saved from previous session
    this.flushPending();

    if (__DEV__) {
      console.log('[CrashReporter] Initialized. Endpoint:', CRASH_ENDPOINT);
    }
  }
}

// Singleton
export const crashReporter = new CrashReporter();
export default crashReporter;
```

#### Step 2: Initialize in root layout

- [ ] In `mobile/src/app/_layout.tsx`, add import at top:

```typescript
import { crashReporter } from '@/lib/crash-reporter';
```

- [ ] At the top of the `RootLayout` component, before any hooks, add:

```typescript
// Initialize crash reporter once on app start
const reporterInitialized = useRef(false);
if (!reporterInitialized.current) {
  reporterInitialized.current = true;
  crashReporter.initialize();
}
```

- [ ] After useAuthStore bootstrap or useSegments, add user tracking:

```typescript
// Track current user for crash context
useEffect(() => {
  if (user?.id) {
    crashReporter.setUser(user.id);
  }
}, [user?.id]);
```

- [ ] Track screen changes (add after useSegments hook):

```typescript
useEffect(() => {
  const screen = segments.join('/') || 'root';
  crashReporter.setCurrentScreen(screen);
}, [segments]);
```

#### Step 3: Wire into error boundary

- [ ] In `mobile/src/components/app-error-boundary.tsx`, add import at top:

```typescript
import { crashReporter } from '@/lib/crash-reporter';
```

- [ ] In the `componentDidCatch` method, add crash reporting:

```typescript
componentDidCatch(error: unknown, info: React.ErrorInfo) {
  // Report to our crash endpoint
  crashReporter.captureError(error, 'AppErrorBoundary');
  // Keep existing console.error for dev visibility
  console.error('AppErrorBoundary caught:', error, info);
  // ... existing code continues
}
```

#### Step 4: Add breadcrumbs from key user actions

- [ ] In `mobile/src/lib/api/client.ts`, locate the `fetch` wrapper or request interceptor. Add breadcrumbs for API calls:

```typescript
// After each successful request:
crashReporter.addBreadcrumb('api_call', `${method} ${url}`, {
  status: response.status,
  duration_ms: elapsed,
});
```

- [ ] In `mobile/src/stores/auth-store.ts`, add breadcrumbs for auth events:

```typescript
// In login success:
crashReporter.addBreadcrumb('auth', 'login_success');
// In token refresh:
crashReporter.addBreadcrumb('auth', 'token_refreshed');
// In logout:
crashReporter.addBreadcrumb('auth', 'logout');
```

#### Step 5: Verify

- [ ] Start the app in Expo Go or dev build
- [ ] Check Metro logs: `[CrashReporter] Initialized. Endpoint: http://...`
- [ ] Trigger a test crash (tap a button that throws): `throw new Error("Test crash from HomeScreen")`
- [ ] Check backend: `curl http://localhost:8000/api/v1/admin/crash-reports -H "Authorization: Bearer <admin_token>"`
- [ ] Verify breadcrumbs appear in the crash report
- [ ] Kill the app and restart — `flushPending()` should have sent any queued crashes

---

### Task 3: Database Pool Tuning + Health Check 503

**Files:**
- Modify: `backend/app/core/config.py`
- Modify: `backend/app/core/db.py`
- Modify: `backend/app/main.py` (health endpoint)
- Modify: `docker-compose.prod.yml` (PostgreSQL memory)

#### Step 1: Add pool settings to config

- [ ] Add to `backend/app/core/config.py` after `database_url` field:

```python
database_pool_size: int = 20
database_max_overflow: int = 30
```

#### Step 2: Use config values in db.py

- [ ] In `backend/app/core/db.py`, modify `get_engine()`:

```python
def get_engine() -> AsyncEngine:
    global _engine, _session_factory
    if _engine is None:
        settings = get_settings()
        _engine = create_async_engine(
            settings.database_url,
            pool_size=settings.database_pool_size,
            max_overflow=settings.database_max_overflow,
            pool_pre_ping=True,
            pool_recycle=300,
        )
        _session_factory = async_sessionmaker(_engine, expire_on_commit=False)
    return _engine
```

#### Step 3: Fix health check to return 503 on Redis failure

- [ ] In `backend/app/main.py`, replace the `health()` function (lines 160-170):

```python
@app.get("/api/v1/health")
async def health() -> dict[str, Any]:
    """Liveness + dependency check: DB (with PostGIS) and Redis must answer.
    
    Returns 200 if all dependencies healthy, 503 if any dependency fails.
    """
    from fastapi.responses import JSONResponse

    errors: list[str] = []
    postgis_version = None

    # PostGIS check
    try:
        async with get_engine().connect() as conn:
            postgis_version = (await conn.execute(text("SELECT PostGIS_Version()"))).scalar()
    except Exception as exc:
        errors.append(f"PostGIS: {exc}")

    # Redis check
    try:
        r = get_redis()
        await r.ping()
    except Exception as exc:
        errors.append(f"Redis: {exc}")

    if errors:
        return JSONResponse(
            status_code=503,
            content={"status": "unhealthy", "errors": errors},
        )

    return {"status": "ok", "postgis": postgis_version}
```

#### Step 4: Verify

- [ ] Start docker: `docker compose up -d db redis minio`
- [ ] Run: `curl http://localhost:8000/api/v1/health`

Expected: `{"status":"ok","postgis":"3.4 USE_GEOS=1..."}`

- [ ] Stop Redis: `docker compose stop redis`
- [ ] Run health check again

Expected: HTTP 503 with `{"status":"unhealthy","errors":["Redis: ..."]}`

---

### Task 4: main.py Decomposition

**Files:**
- Create: `backend/app/routers.py`
- Create: `backend/app/lifespan.py`
- Create: `backend/app/storage_proxy.py`
- Modify: `backend/app/main.py`

#### Step 1: Extract router registration to routers.py

- [ ] Create `backend/app/routers.py`:

```python
"""Router registration — single place for all module routers."""

from fastapi import FastAPI


def register_routers(app: FastAPI) -> None:
    from app.modules.auth.router import router as auth_router
    from app.modules.books.router import router as books_router
    from app.modules.wishlist.router import router as wishlist_router
    from app.modules.exchanges.router import router as exchanges_router
    from app.modules.places.router import router as places_router
    from app.modules.ratings.router import router as ratings_router
    from app.modules.reports.router import router as reports_router
    from app.modules.notifications.router import router as notifications_router
    from app.modules.geofence.router import router as geofence_router
    from app.modules.chat.router import router as chat_exchange_router
    from app.modules.chat.router import chat_router
    from app.modules.chat.router import ws_router
    from app.modules.admin.router import router as admin_router

    app.include_router(auth_router, prefix="/api/v1")
    app.include_router(books_router, prefix="/api/v1")
    app.include_router(wishlist_router, prefix="/api/v1")
    app.include_router(exchanges_router, prefix="/api/v1")
    app.include_router(places_router, prefix="/api/v1")
    app.include_router(ratings_router, prefix="/api/v1")
    app.include_router(reports_router, prefix="/api/v1")
    app.include_router(notifications_router, prefix="/api/v1")
    app.include_router(geofence_router, prefix="/api/v1")
    app.include_router(chat_exchange_router, prefix="/api/v1")
    app.include_router(chat_router, prefix="/api/v1")
    app.include_router(ws_router)  # WebSocket at /ws/chat (outside /api/v1)
    app.include_router(admin_router, prefix="/api/v1")
```

#### Step 2: Extract lifespan to lifespan.py

- [ ] Copy the entire `lifespan()` async generator function from `main.py` (lines 24-138) to `backend/app/lifespan.py`
- [ ] In `lifespan.py`, add imports at top:

```python
"""FastAPI lifespan: startup/shutdown hooks."""

import asyncio
import json
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.core.config import get_settings
from app.core.db import get_session_factory
# Crash reports initialized via lifespan (no external SDK needed)

logger = logging.getLogger("app.lifespan")
```

- [ ] Move the `@asynccontextmanager` decorated `lifespan` function here

#### Step 3: Extract storage proxy to storage_proxy.py

- [ ] Copy the `proxy_storage` endpoint (lines 246-273 of main.py) to `backend/app/storage_proxy.py`:

```python
"""MinIO storage proxy endpoint — fallback when Traefik→MinIO routing is broken."""

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

from app.core.config import get_settings

router = APIRouter()


@router.get("/storage/{bucket}/{path:path}")
@router.head("/storage/{bucket}/{path:path}")
async def proxy_storage(bucket: str, path: str):
    """Fetch a file from MinIO and return it directly."""
    settings = get_settings()
    if not settings.s3_endpoint or not settings.s3_access_key:
        raise HTTPException(status_code=404, detail="Storage not configured")

    try:
        import aioboto3
        from botocore.config import Config

        session = aioboto3.Session()
        async with session.client(
            "s3",
            endpoint_url=settings.s3_endpoint,
            aws_access_key_id=settings.s3_access_key,
            aws_secret_access_key=settings.s3_secret_key,
            config=Config(signature_version="s3v4"),
        ) as client:
            response = await client.get_object(Bucket=bucket, Key=path)
            body = await response["Body"].read()
            ct = response.get("ContentType", "application/octet-stream")
            return Response(content=body, media_type=ct, headers={
                "Cache-Control": "public, max-age=31536000",
            })
    except Exception:
        raise HTTPException(status_code=404, detail="File not found")
```

#### Step 4: Simplify main.py

- [ ] Replace `main.py` with clean version:

```python
"""MeetBook API application factory."""

import logging

import redis.asyncio as aioredis
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pathlib import Path

from app.core.config import get_settings
from app.core.rate_limit import RateLimitConfig, RateLimitMiddleware
from app.core.redis import get_redis
from app.lifespan import lifespan
from app.routers import register_routers
from app.storage_proxy import router as storage_router

logger = logging.getLogger("app.access")


def create_app() -> FastAPI:
    settings = get_settings()
    is_dev = settings.env in ("local", "dev", "development", "test")

    app = FastAPI(
        title="MeetBook API",
        version="0.1.0",
        lifespan=lifespan,
        docs_url="/api/docs" if is_dev else None,
        redoc_url="/redoc" if is_dev else None,
        openapi_url="/api/openapi.json" if is_dev else None,
    )

    # CORS
    app.add_middleware(
        CORSMiddleware,
        allow_origins=get_settings().cors_origins_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Crash reports are submitted via POST /api/v1/crash-report (no auth needed)
    # and viewed via admin panel at /api/v1/admin/crash-reports

    # Health check
    from sqlalchemy import text
    from app.core.db import get_engine
    from typing import Any
    from fastapi.responses import JSONResponse

    @app.get("/api/v1/health")
    async def health() -> dict[str, Any]:
        errors: list[str] = []
        postgis_version = None
        try:
            async with get_engine().connect() as conn:
                postgis_version = (await conn.execute(text("SELECT PostGIS_Version()"))).scalar()
        except Exception as exc:
            errors.append(f"PostGIS: {exc}")
        try:
            r = get_redis()
            await r.ping()
        except Exception as exc:
            errors.append(f"Redis: {exc}")
        if errors:
            return JSONResponse(status_code=503, content={"status": "unhealthy", "errors": errors})
        return {"status": "ok", "postgis": postgis_version}

    # Module routers
    register_routers(app)

    # Storage proxy (fallback MinIO access)
    app.include_router(storage_router)

    # Rate limiting
    redis_client = aioredis.from_url(get_settings().redis_url)
    rate_config = RateLimitConfig(
        requests_per_minute=300,
        route_limits={
            "/api/v1/auth/register": (30, 3600),
            "/api/v1/auth/login": (30, 60),
            "/api/v1/auth/refresh": (60, 60),
            "/api/v1/auth/password-reset-request": (20, 3600),
            "/api/v1/auth/password-reset-confirm": (20, 3600),
            "/api/v1/places": (120, 60),
            "/api/v1/reports": (60, 3600),
            "/api/v1/admin": (120, 60),
        },
    )
    app.add_middleware(RateLimitMiddleware, redis_client=redis_client, config=rate_config)

    # Static media (local dev only)
    media_dir = Path(get_settings().media_dir)
    media_dir.mkdir(parents=True, exist_ok=True)
    app.mount("/media", StaticFiles(directory=str(media_dir)), name="media")

    return app


app = create_app()
```

#### Step 5: Verify

- [ ] Run: `cd backend && uv run python -c "from app.main import app; print('OK')"`

Expected: `OK` without import errors. No circular imports.

- [ ] Run: `docker compose up -d backend`
- [ ] Run: `curl http://localhost:8000/api/v1/health`

Expected: 200 OK with PostGIS version.

---

### Task 5: S3 Client DRY — Shared Context Manager

**Files:**
- Modify: `backend/app/core/s3.py`
- Modify: `backend/app/lifespan.py`
- Modify: `backend/app/storage_proxy.py`

#### Step 1: Add get_s3_client to core/s3.py

- [ ] In `backend/app/core/s3.py`, add this function after the `_is_s3_configured()` function (after line 19):

```python
from contextlib import asynccontextmanager
from collections.abc import AsyncIterator
from typing import Any


@asynccontextmanager
async def get_s3_client() -> AsyncIterator[Any]:
    """Shared S3 client context manager used by lifespan, storage proxy, and uploads.
    
    Usage:
        async with get_s3_client() as client:
            await client.put_object(Bucket=..., Key=..., Body=...)
    """
    import aioboto3
    from botocore.config import Config

    settings = get_settings()
    session = aioboto3.Session()
    async with session.client(
        "s3",
        endpoint_url=settings.s3_endpoint or None,
        aws_access_key_id=settings.s3_access_key,
        aws_secret_access_key=settings.s3_secret_key,
        config=Config(signature_version="s3v4"),
    ) as client:
        yield client
```

#### Step 2: Use get_s3_client in lifespan.py

- [ ] In `backend/app/lifespan.py`, replace the three S3 client blocks in the lifespan function with calls to `get_s3_client()`:

```python
from app.core.s3 import get_s3_client

# Bucket existence check
try:
    async with get_s3_client() as client:
        await client.head_bucket(Bucket=settings.s3_bucket)
except Exception:
    try:
        async with get_s3_client() as client:
            await client.create_bucket(Bucket=settings.s3_bucket)
            logger.info("Created S3 bucket: %s", settings.s3_bucket)
    except Exception:
        pass

# Bucket public-read policy
try:
    async with get_s3_client() as client:
        await client.put_bucket_policy(
            Bucket=settings.s3_bucket,
            Policy=json.dumps({
                "Version": "2012-10-17",
                "Statement": [{
                    "Effect": "Allow",
                    "Principal": "*",
                    "Action": ["s3:GetObject"],
                    "Resource": f"arn:aws:s3:::{settings.s3_bucket}/*",
                }],
            }),
        )
        logger.info("Bucket policy set to public-read: %s", settings.s3_bucket)
except Exception as exc:
    logger.warning("Could not set bucket public-read policy: %s", exc)
```

#### Step 3: Use get_s3_client in storage_proxy.py

- [ ] In `backend/app/storage_proxy.py`, replace the inline S3 client with `get_s3_client()`:

```python
from app.core.s3 import get_s3_client

# Inside proxy_storage(), replace the try block with:
try:
    async with get_s3_client() as client:
        response = await client.get_object(Bucket=bucket, Key=path)
        body = await response["Body"].read()
        ct = response.get("ContentType", "application/octet-stream")
        return Response(content=body, media_type=ct, headers={
            "Cache-Control": "public, max-age=31536000",
        })
except Exception:
    raise HTTPException(status_code=404, detail="File not found")
```

#### Step 4: Update _upload_s3 and _delete_s3 to use shared client

- [ ] In `backend/app/core/s3.py`, update `_upload_s3()` (replace lines 86-117):

```python
async def _upload_s3(
    book_id: uuid.UUID, filename: str, file_bytes: bytes, content_type: str
) -> str:
    settings = get_settings()
    key = f"books/{book_id}/{filename}"

    async with get_s3_client() as client:
        await client.put_object(
            Bucket=settings.s3_bucket,
            Key=key,
            Body=file_bytes,
            ContentType=content_type,
        )

    external = settings.s3_external_endpoint or settings.s3_endpoint
    if external:
        return f"{external}/{settings.s3_bucket}/{key}"
    return f"https://{settings.s3_bucket}.s3.amazonaws.com/{key}"
```

- [ ] Update `_delete_s3()` similarly:

```python
async def _delete_s3(url: str) -> None:
    settings = get_settings()
    key = _extract_key(url, settings.s3_bucket)

    async with get_s3_client() as client:
        await client.delete_object(Bucket=settings.s3_bucket, Key=key)
```

- [ ] Remove `_session` global and the `import aioboto3` / `from botocore.config import Config` from the top of `_upload_s3` and `_delete_s3` (they're now in `get_s3_client()`).

#### Step 5: Remove unused imports

- [ ] Remove `import json` from `main.py` if it was only used for bucket policy (now in lifespan.py)
- [ ] Run: `uv run ruff check .` and fix any issues

---

### Task 6: Structured Logging Middleware

**Files:**
- Create: `backend/app/core/logging_middleware.py`
- Modify: `backend/app/main.py`
- Modify: `docker-compose.prod.yml`

#### Step 1: Create logging middleware

- [ ] Create `backend/app/core/logging_middleware.py`:

```python
"""Structured JSON logging with per-request context."""

import logging
import time
import uuid

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.types import ASGIApp


class StructuredLoggingMiddleware(BaseHTTPMiddleware):
    """Adds request_id, duration_ms, method, path, status_code to every log entry.
    
    Uses logging.LogAdapter to inject context into all log calls during the request.
    """

    def __init__(self, app: ASGIApp) -> None:
        super().__init__(app)
        # Configure root logger for JSON output (production) or human-readable (dev)
        self._configure_root_logger()

    def _configure_root_logger(self) -> None:
        """Ensure root logger has a handler that outputs structured logs."""
        root = logging.getLogger()
        if root.handlers:
            return  # Already configured (e.g., by uvicorn)

        handler = logging.StreamHandler()
        formatter = logging.Formatter(
            '{"time": "%(asctime)s", "level": "%(levelname)s", '
            '"logger": "%(name)s", "message": "%(message)s", '
            '"request_id": "%(request_id)s", '
            '"method": "%(method)s", "path": "%(path)s", '
            '"status": %(status_code)s, "duration_ms": %(duration_ms)s}',
            datefmt="%Y-%m-%dT%H:%M:%S",
        )
        handler.setFormatter(formatter)
        root.addHandler(handler)
        root.setLevel(logging.INFO)

    async def dispatch(self, request: Request, call_next):
        request_id = str(uuid.uuid4())[:8]
        start = time.monotonic()

        # Inject context into all log adapters during this request
        extra = {
            "request_id": request_id,
            "method": request.method,
            "path": request.url.path,
            "status_code": 0,
            "duration_ms": 0,
        }

        # Attach to request state for downstream loggers
        request.state.request_id = request_id

        response = await call_next(request)

        duration_ms = round((time.monotonic() - start) * 1000)
        extra["status_code"] = response.status_code
        extra["duration_ms"] = duration_ms

        logger = logging.getLogger("app.access")
        logger.info(
            "%s %s → %s (%sms)",
            request.method,
            request.url.path,
            response.status_code,
            duration_ms,
            extra=extra,
        )

        response.headers["X-Request-ID"] = request_id
        return response
```

#### Step 2: Wire into main.py

- [ ] In `backend/app/main.py`, add after CORS middleware setup:

```python
from app.core.logging_middleware import StructuredLoggingMiddleware
app.add_middleware(StructuredLoggingMiddleware)
```

**IMPORTANT:** Add this BEFORE rate limiting middleware but AFTER CORS. The order matters: CORS → StructuredLogging → RateLimit.

#### Step 3: Docker logging config

- [ ] In `docker-compose.prod.yml`, add under `backend:` service:

```yaml
logging:
  driver: "json-file"
  options:
    max-size: "10m"
    max-file: "3"
```

---

### Task 7: Redis Response Cache — Bbox Book Search

**Files:**
- Modify: `backend/app/core/redis.py`
- Modify: `backend/app/modules/books/router.py` (or `service.py`)

#### Step 1: Add cache helpers to core/redis.py

- [ ] Add to `backend/app/core/redis.py`:

```python
import hashlib
import json
from typing import Any


async def get_cached(key: str) -> bytes | None:
    """Get a cached value by key. Returns None on miss or decoding error."""
    try:
        return await get_redis().get(key)
    except Exception:
        return None


async def set_cached(key: str, value: Any, ttl_seconds: int = 60) -> None:
    """Set a cache key with TTL. Value is JSON-serialized."""
    try:
        await get_redis().setex(key, ttl_seconds, json.dumps(value, default=str))
    except Exception:
        pass  # Cache is best-effort; never block a request


def bbox_cache_key(
    min_lat: float, max_lat: float, min_lng: float, max_lng: float,
    category: str | None, language: str | None, condition: str | None,
    q: str | None, limit: int,
) -> str:
    """Generate a stable cache key for bbox search params."""
    raw = f"{min_lat:.4f}|{max_lat:.4f}|{min_lng:.4f}|{max_lng:.4f}|{category}|{language}|{condition}|{q}|{limit}"
    digest = hashlib.md5(raw.encode()).hexdigest()
    return f"bbox:{digest}"
```

#### Step 2: Add cache layer to books router

- [ ] In `backend/app/modules/books/router.py`, modify `search_books_bbox`:

```python
from app.core.redis import bbox_cache_key, get_cached, set_cached
import json

@router.get("/search-bbox", response_model=BookSearchResponse)
async def search_books_bbox(
    min_lat: float = Query(..., ge=-90, le=90),
    max_lat: float = Query(..., ge=-90, le=90),
    min_lng: float = Query(..., ge=-180, le=180),
    max_lng: float = Query(..., ge=-180, le=180),
    category: str | None = Query(default=None),
    language: str | None = Query(default=None),
    condition: str | None = Query(default=None),
    q: str | None = Query(default=None, max_length=100),
    cursor: str | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=50),
    user: User = Depends(get_current_user),
    service: BookService = Depends(_get_service),
) -> BookSearchResponse:
    # Anonymous cache: only cache requests without cursor (first page),
    # no text search (q is cache-busting), authenticated user distance
    # calculations vary per user so we skip cache for logged-in users.
    # In practice, the home screen map does NOT pass cursor and always
    # uses the current user, so we cache based on bbox+user_id.
    cache_key = bbox_cache_key(
        min_lat, max_lat, min_lng, max_lng,
        category, language, condition, q, limit,
    )
    # Append user_id to make cache user-specific (distance is per-user)
    cache_key = f"{cache_key}:u{user.id}"

    if not cursor and not q:
        cached = await get_cached(cache_key)
        if cached:
            return BookSearchResponse(**json.loads(cached))

    try:
        result = await service.search_bbox(
            min_lat, max_lat, min_lng, max_lng,
            category, language, condition, q, limit, current_user_id=user.id,
            cursor=cursor,
        )
    except BookError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)

    # Cache first page only (TTL: 30 seconds — fast enough for map pan)
    if not cursor and not q:
        await set_cached(cache_key, result.model_dump(), ttl_seconds=30)

    return result
```

#### Step 3: Verify

- [ ] Start backend: `docker compose up -d backend`
- [ ] Run: `curl "http://localhost:8000/api/v1/search-bbox?min_lat=41.0&max_lat=41.1&min_lng=28.9&max_lng=29.0&limit=10" -H "Authorization: Bearer <token>"`

Expected: Normal response. Check Redis: `docker compose exec redis redis-cli -a meetbook_dev KEYS "bbox:*"` — should see cached keys.

- [ ] Run same request again — should be faster (cache hit). Verify response is identical.

---

### Task 8: Mobile — Home Screen Skeleton Loading

**Files:**
- Modify: `mobile/src/app/tabs/home.tsx`

#### Step 1: Add skeleton loading state

- [ ] In `mobile/src/app/tabs/home.tsx`, locate the BookBottomSheet component (around line 1114).

- [ ] Add a loading state check before rendering the sheet. The `bboxQuery.isLoading` and `bboxQuery.isFetching` states control whether to show skeletons:

```typescript
// Add below sortedBooks useMemo (around line 416):

// Determine if we should show skeleton cards
const showSkeletons = bboxQuery.isLoading || (bboxQuery.isFetching && books.length === 0);
```

- [ ] Locate the `emptyComponent` prop on `BookBottomSheet` (around line 1121). Replace it with:

```tsx
emptyComponent={
  bboxQuery.isError ? (
    <EmptyState
      message="Kitaplar yüklenemedi"
      description="İnternet bağlantınızı kontrol edin."
      icon="cloud-offline-outline"
    />
  ) : showSkeletons ? (
    <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
      {[...Array(5)].map((_, i) => (
        <View
          key={i}
          style={[styles.miniCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <View style={[styles.miniCardCover, { backgroundColor: colors.surfaceAlt }]}>
            <View style={[styles.skeletonBox, { width: 48, height: 64, backgroundColor: colors.surfaceAlt }]} />
          </View>
          <View style={styles.miniCardInfo}>
            <View style={[styles.skeletonLine, { width: '70%', height: 14, backgroundColor: colors.surfaceAlt, marginBottom: 6 }]} />
            <View style={[styles.skeletonLine, { width: '40%', height: 12, backgroundColor: colors.surfaceAlt, marginBottom: 6 }]} />
            <View style={styles.miniCardMeta}>
              <View style={[styles.skeletonPill, { width: 50, height: 20, backgroundColor: colors.surfaceAlt }]} />
              <View style={[styles.skeletonLine, { width: 30, height: 12, backgroundColor: colors.surfaceAlt, marginLeft: 8 }]} />
            </View>
          </View>
        </View>
      ))}
    </View>
  ) : (
    <EmptyState
      message="Bu bölgede kitap yok"
      description="Arama alanını genişlet veya filtreleri değiştir"
      icon="library-outline"
    />
  )
}
```

**Note:** The error overlay View at lines 934-948 in home.tsx should remain — it serves as a full-screen error background. The `emptyComponent` above replaces only the sheet's empty state.

#### Step 2: Add skeleton styles to StyleSheet

- [ ] In `home.tsx`, in the `StyleSheet.create()` block at the bottom of the file, add these skeleton style entries (after the existing `dimOverlay` or any other style):

```typescript
skeletonBox: {
  borderRadius: 4,
},
skeletonLine: {
  borderRadius: 3,
},
skeletonPill: {
  borderRadius: 10,
},
```

#### Step 3: Verify

- [ ] Run the app (Expo Go or dev build)
- [ ] On the home screen, the first load should show 5 skeleton cards
- [ ] Once data loads, real cards replace skeletons
- [ ] Pull-to-refresh should NOT show skeletons (only `isLoading && books.length === 0` triggers them)

---

### Task 9: Optional — Push Notification Cleanup

**Files:**
- Modify: `mobile/src/app/tabs/home.tsx`
- Modify: `mobile/package.json` (optional removal)

#### Step 1: Decide — implement or remove

The push notification banner code in `home.tsx` currently shows a banner but:
- Requires `expo-notifications` (crash in Expo Go)
- Requires `expo-dev-client` build
- Has no backend endpoint for token registration
- Has no server-side push sending logic

**Option A: Remove entirely** (recommended for now — revisit after production launch):

- [ ] Remove `expo-notifications` import and all push-related code from `home.tsx`:
  - Delete lines 38-45 (Notification import + dynamic require)
  - Delete line 198 (`showPushBanner` state)
  - Delete lines 249-295 (useEffect for push banner + requestPushPermission + dismissPushBanner)
  - Delete lines 1070-1087 (push banner JSX)

- [ ] Run: `npx expo install --check` to verify no unmet peer deps

**Option B: Complete push flow** (if you want it now):

1. Backend: Create `POST /api/v1/notifications/register-push-token` endpoint
2. Backend: Store `{user_id, expo_push_token, platform, created_at}` in DB
3. Backend: Add push sending logic in notification service
4. Mobile: Send token to backend after successful `getExpoPushTokenAsync()`

If choosing Option B, reply and I'll write a separate plan.

---

### Task 10: Production Docker Fine-Tuning

**Files:**
- Modify: `docker-compose.prod.yml`

#### Step 1: Increase PostgreSQL memory

- [ ] In `docker-compose.prod.yml`, change the `db` service's memory limit from `1G` to `2G`:

```yaml
db:
  deploy:
    resources:
      limits:
        memory: 2G
      reservations:
        memory: 512M
```

#### Step 2: Add PostgreSQL performance config

- [ ] Add PostgreSQL config as environment variables:

```yaml
db:
  environment:
    POSTGRES_USER: meetbook
    POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    POSTGRES_DB: meetbook
  command: >
    postgres
    -c shared_buffers=512MB
    -c effective_cache_size=1536MB
    -c maintenance_work_mem=128MB
    -c wal_buffers=16MB
    -c max_worker_processes=4
    -c max_parallel_workers_per_gather=2
    -c max_parallel_workers=4
    -c random_page_cost=1.1
```

#### Step 3: Add Redis persistence

- [ ] In `docker-compose.prod.yml`, add Redis AOF persistence:

```yaml
redis:
  command: ["redis-server", "--requirepass", "${REDIS_PASSWORD}", "--appendonly", "yes", "--appendfsync", "everysec"]
```

#### Step 4: Backend resource limits

- [ ] In `docker-compose.prod.yml`, verify backend CPU/memory:

```yaml
backend:
  deploy:
    resources:
      limits:
        cpus: '2'
        memory: 1G
      reservations:
        memory: 512M
```

- [ ] Add uvicorn workers config (optional, for multi-core):

```yaml
backend:
  environment:
    UVICORN_WORKERS: "2"
```

---

## Execution Order & Dependencies

```
Task 1 (Crash Backend) ───┐
Task 2 (Crash Mobile)  ───┤ Independent — run in parallel
                           │
Task 3 (DB Pool) ─────────┤ Independent
                           │
Task 4 (main.py split) ───┤ Depends on Task 1 (uses crash_reports router)
Task 5 (S3 DRY) ──────────┤ Depends on Task 4 (uses lifespan.py)
Task 7 (Redis cache) ─────┤ Independent
                           │
Task 6 (Logging) ─────────┤ Independent
                           │
Task 8 (Skeleton UX) ─────┤ Independent (mobile only)
                           │
Task 10 (Docker tuning) ──┤ Last — validates all previous changes
                           │
Task 9 (Push cleanup) ────┘ Optional — run anytime if choosing Option A
```

**Critical path:** Tasks 1+3+4+5+10 (~2 hours sequential)  
**Parallelizable:** Tasks 2, 6, 7, 8 (can run simultaneously with critical path)

---

## Completion Checklist

- [ ] `curl /api/v1/health` returns 503 when Redis is down
- [ ] Crash report sent from mobile appears in `GET /api/v1/admin/crash-reports`
- [ ] Breadcrumbs visible in crash report detail (last N user actions)
- [ ] `docker compose up` starts without import errors
- [ ] Bbox search returns cached results on second identical request
- [ ] Home screen shows skeleton cards during initial load
- [ ] `main.py` is under 150 lines (was 278)
- [ ] No duplicate S3 client code (`get_s3_client()` is the single source)
- [ ] Production docker-compose has PostgreSQL perf config
