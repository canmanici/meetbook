# MeetBook Admin Panel — Full Design Specification

## 1. Overview

A comprehensive, multi-role admin panel with granular permissioning, full audit trail,
beta tester management, and a modular page architecture. Built as a single-page application
(vanilla JS, served from FastAPI backend as a static file).

**Core Philosophy:** Every admin action is a logged permission check. Every user action
in the panel flows through `PermissionService → AuditService → Execution`.

---

## 2. Permission System

### 2.1 Data Model

```
Permission {
  id: UUID PK
  codename: string (unique)       # e.g. "users.ban", "system.logs"
  label: string                    # e.g. "Kullanıcı Banlama"
  group: string                    # e.g. "users", "system", "roles"
  description: string | null
  created_at: datetime
}

Role {
  id: UUID PK
  name: string (unique)            # e.g. "super_admin", "developer"
  label: string                    # e.g. "Süper Admin"
  level: int                       # 1-10 hierarchy (higher = more privileged)
  color: string                    # hex color for UI badge
  description: string | null
  is_system: boolean               # system roles cannot be deleted
  created_by: UUID FK (users)
  created_at: datetime
  updated_at: datetime
}

RolePermission {
  id: UUID PK
  role_id: UUID FK (roles)
  permission_id: UUID FK (permissions)
  granted_by: UUID FK (users)
  created_at: datetime
  UNIQUE(role_id, permission_id)
}

UserRole {
  id: UUID PK
  user_id: UUID FK (users)
  role_id: UUID FK (roles)
  granted_by: UUID FK (users)
  expires_at: datetime | null      # null = permanent, set = temporary
  reason: string | null
  created_at: datetime
}

BetaRequest {
  id: UUID PK
  user_id: UUID FK (users)
  status: enum(pending, approved, rejected)
  reviewed_by: UUID FK (users) | null
  reviewed_at: datetime | null
  rejection_reason: string | null
  created_at: datetime
  updated_at: datetime
}
```

### 2.2 Permission Categories

| Prefix        | Permissions                                              | Default Role        |
|---------------|----------------------------------------------------------|---------------------|
| `users.*`     | list, view, edit, ban, suspend, delete, messages, locations | super_admin, dev, security |
| `books.*`     | list, view, edit, delete, takedown, categories           | super_admin, dev    |
| `exchanges.*` | list, view, force_complete, cancel, dispute              | super_admin, dev    |
| `reports.*`   | view, claim, resolve, dismiss                            | super_admin, dev, security |
| `system.*`    | logs, config, workers, cache, health                     | super_admin, dev    |
| `ips.*`       | view, block, unblock, whitelist, logs                    | super_admin, security |
| `ratelimit.*` | view, configure, reset                                   | super_admin, dev, security |
| `roles.*`     | list, create, edit, delete, assign, permissions_view, permissions_grant | super_admin |
| `notifications.*` | send, broadcast, history, email_verify              | super_admin, marketing |
| `finance.*`   | transactions, refunds, invoices, reports                 | super_admin, finance |
| `analytics.*` | view, export, cohorts, funnel                            | super_admin, dev, marketing, finance |
| `features.*`  | beta, preview, early_access                              | super_admin, dev, beta_tester |
| `audit.*`     | view, export, delete                                     | super_admin, security |
| `beta.*`      | manage_requests, approve, reject, view_stats             | super_admin, marketing |

### 2.3 Default Roles

| Role            | Level | Color    | Permissions                              |
|-----------------|-------|----------|------------------------------------------|
| super_admin     | 10    | #ef4444  | ALL (cannot be modified)                 |
| developer       | 8     | #3b82f6  | users.*, books.*, exchanges.*, reports.*, system.*, analytics.*, ratelimit.*, features.beta |
| security        | 8     | #ef4444  | users.list/view/ban/suspend, reports.*, ips.*, ratelimit.*, audit.* |
| marketing       | 5     | #f59e0b  | notifications.send/broadcast/history, analytics.view/export, beta.manage_requests |
| finance         | 5     | #10b981  | finance.*, analytics.view/export         |
| beta_tester     | 2     | #8b5cf6  | features.beta, features.preview, bugs.report, feedback.submit |

### 2.4 Temporary Permissions

- Super Admin can grant **any permission** to **any user** with an expiry date
- Stored as `UserRole` with `expires_at` set
- A background worker (`workers/expire_permissions.py`) runs every 10 minutes:
  - Finds all expired `UserRole` rows where `expires_at < now()`
  - Deletes them (or sets `status = expired`)
  - Creates audit log entries
  - Sends notifications (see Section 5)
- UI: Super Admin sees a "Geçici İzinler" tab showing active + expired grants

### 2.5 Role CRUD (Super Admin Only)

- Create: name, label, level, color, description, permission checkboxes
- Edit: same fields (except `is_system` roles are read-only)
- Delete: confirmation modal, fails if users are assigned to the role
- Import: JSON file upload → validate → preview changes → apply
- Export: JSON / CSV / YAML download of all roles + their permissions

---

## 3. Beta Tester System

### 3.1 User Flow

1. **Settings page**: Toggle switch labeled "Beta Özellikleri Dene"
   - Off state: "Beta özelliklerini dener misin?" with info
   - Click to turn on → popup appears
   - Already active: shows "✅ Aktif" with active beta features list
   - Pending approval: shows "⏳ Onay Bekliyor" with estimated time

2. **Consent Popup** (shown on toggle-on):
   ```
   ┌──────────────────────────────────────┐
   │  🧪 Beta Özellikleri Aktifleştir     │
   │                                      │
   │  Beta sürümüne katılmak üzeresiniz.  │
   │                                      │
   │  🚨 Bu şunları içerebilir:           │
   │  • Kararsız özellikler ve hatalar    │
   │  • Veri kaybı veya bozulma riski     │
   │  • Değişen UI ve akışlar             │
   │  • Geri bildirim zorunluluğu         │
   │  • İstediğiniz zaman çıkabilirsiniz  │
   │                                      │
   │     [Vazgeç]    [Beta İsteği Gönder] │
   └──────────────────────────────────────┘
   ```

3. **Request sent**: Creates `BetaRequest` with `status=pending`
   - Notification sent to all users with `beta.manage_requests` permission
   - User sees "⏳ Onay Bekliyor" on their settings page

4. **Admin Review** (Super Admin or Marketing):
   - Notification inbox item: "🧪 Yeni beta talebi: user@email.com"
   - Click opens review panel showing:
     - User profile summary (join date, book count, rating, trust score)
     - Request date
     - Previous beta history (if any)
     - Actions: ✅ Onayla / ❌ Reddet (with reason textarea)
   - On approve: `UserRole` created with `role_id = beta_tester`, `BetaRequest` updated
   - On reject: `BetaRequest.status = rejected`, user notified

5. **Post-approval**:
   - User gets notification: "Beta özellikleri aktif! 🎉"
   - Settings toggle shows active with beta feature list
   - Beta dashboard section shows stats (active beta count, feedback count, etc.)

### 3.2 Beta Groups

- `alpha_testers` — all beta features, unstable builds
- `beta_testers` — stable beta features (default for approved requests)
- `early_adopters` — preview-only, minimal risk

Each group is implemented as a separate role with specific `features.*` permissions.

---

## 4. Admin Panel Architecture

### 4.1 Page Structure

```
/admin/index.html  ← SPA entry point (single HTML file)

Pages:
├── Auth
│   └── Login
├── CEO Dashboard       ← KPI overview, charts, recent activity, system health
├── Derin Analiz        ← Multi-tab analytics (users, books, exchanges, trust)
├── Yönetim
│   ├── Kullanıcılar    ← List/search/detail/actions + messages + locations + history
│   ├── Kitaplar         ← List/search/detail/actions + exchange history
│   └── Takaslar         ← Pipeline view + detail + messages + force actions
├── İçerik
│   └── Raporlar         ← Queue + detail + quick actions + moderation history
├── Bildirimler
│   ├── Toplu Bildirim   ← Send to filtered users, preview, schedule
│   └── Beta Talepleri   ← Pending/approved/rejected queue
├── Güvenlik
│   ├── IP Yönetimi      ← Block/unblock, whitelist, request logs
│   ├── Rate Limit       ← Current limits, top offenders, reset
│   └── Denetim Kaydı    ← Full audit log search/export
├── Sistem
│   ├── Sistem Sağlığı   ← DB, cache, workers, uptime
│   ├── Crash Raporları  ← List/detail/stack trace
│   └── Çalışanlar       ← Worker status, queues, job history
├── Yetkilendirme
│   ├── Roller           ← List/create/edit/import/export
│   ├── İzinler          ← Permission matrix view
│   ├── Geçici İzinler   ← Active/expired grants + new grant form
│   └── Kullanıcı Rolleri ← User→role assignments
└── Ayarlar
    ├── Admin Profili     ← Personal settings, notifications, beta toggle
    └── Sistem Ayarları  ← Super Admin: config, maintenance mode, env vars
```

### 4.2 JavaScript Architecture

```
Core modules (in window scope, no bundler):
├── API             ← fetch wrapper with auth, error handling, param mapping
├── State           ← global state (user, token, page, pagination, filters)
├── Router          ← hash-based SPA routing + page lifecycle
├── Charts          ← SVG chart engine (line, donut, gauge, sparkline, bar)
├── UI              ← modals, toasts, pagination, confirm dialogs, CSV export
├── Permissions     ← permission check helpers (can(user, 'users.ban'))
├── Notifications   ← real-time notification polling (or WebSocket)
└── Pages           ← one loader function per page
    ├── loadDashboard()
    ├── loadAnalytics()
    ├── loadUsers()
    ├── loadBooks()
    ├── loadExchanges()
    ├── loadReports()
    ├── loadBetaRequests()
    ├── loadIPManagement()
    ├── loadRateLimits()
    ├── loadAuditLog()
    ├── loadRoles()
    ├── loadPermissions()
    ├── loadTempPermissions()
    ├── loadNotifications()
    ├── loadSystemHealth()
    ├── loadCrashReports()
    ├── loadWorkers()
    └── loadSettings()
```

### 4.3 API Routes (Admin)

```
# Existing (keep as-is)
GET    /api/v1/admin/metrics/overview
GET    /api/v1/admin/metrics/trends?days=N
GET    /api/v1/admin/metrics/books
GET    /api/v1/admin/metrics/exchanges
GET    /api/v1/admin/metrics/users
GET    /api/v1/admin/metrics/trust
GET    /api/v1/admin/metrics/system
GET    /api/v1/admin/users?search=&status=&limit=&offset=
GET    /api/v1/admin/users/{id}
GET    /api/v1/admin/books?search=&available_only=&limit=&offset=
GET    /api/v1/admin/books/{id}
GET    /api/v1/admin/exchanges?status=&limit=&offset=
GET    /api/v1/admin/exchanges/{id}
GET    /api/v1/admin/reports?status=
GET    /api/v1/admin/reports/{id}
POST   /api/v1/admin/reports/{id}/claim
POST   /api/v1/admin/reports/{id}/resolve
POST   /api/v1/admin/users/{id}/suspend
POST   /api/v1/admin/users/{id}/reinstate
POST   /api/v1/admin/users/{id}/ban
POST   /api/v1/admin/users/{id}/unban
POST   /api/v1/admin/books/{id}/takedown
GET    /api/v1/admin/blocked-places
POST   /api/v1/admin/blocked-places
DELETE /api/v1/admin/blocked-places/{id}
GET    /api/v1/admin/audit-log?event_type=&limit=&offset=
GET    /api/v1/admin/search?q=

# New Permission System
GET    /api/v1/admin/roles                          → list all roles
POST   /api/v1/admin/roles                          → create role
PUT    /api/v1/admin/roles/{id}                     → update role
DELETE /api/v1/admin/roles/{id}                     → delete role
GET    /api/v1/admin/roles/{id}/permissions          → get role permissions
PUT    /api/v1/admin/roles/{id}/permissions          → set role permissions
POST   /api/v1/admin/roles/import                   → import roles from JSON
GET    /api/v1/admin/roles/export?format=json|csv|yaml

GET    /api/v1/admin/permissions                     → list all permissions
GET    /api/v1/admin/users/{id}/roles                → get user roles
POST   /api/v1/admin/users/{id}/roles                → assign role to user
DELETE /api/v1/admin/users/{id}/roles/{role_id}      → remove role from user

GET    /api/v1/admin/temp-permissions                 → list active/expired grants
POST   /api/v1/admin/temp-permissions                → grant temporary permission
DELETE /api/v1/admin/temp-permissions/{id}           → revoke early

# Beta Requests
GET    /api/v1/admin/beta-requests?status=            → list beta requests
POST   /api/v1/admin/beta-requests/{id}/approve       → approve
POST   /api/v1/admin/beta-requests/{id}/reject        → reject (with reason)
GET    /api/v1/admin/beta-requests/stats              → beta statistics
GET    /api/v1/admin/users/{id}/beta-status           → user's beta status

# User Details (Extended)
GET    /api/v1/admin/users/{id}/exchange-history       → user's exchange list
GET    /api/v1/admin/users/{id}/messages               → user's messages (paginated)
GET    /api/v1/admin/users/{id}/locations              → user's shared locations
GET    /api/v1/admin/users/{id}/crash-reports          → user's crash reports
GET    /api/v1/admin/users/{id}/book-history           → user's book change log

# Notifications
GET    /api/v1/admin/notifications/history              → sent notifications
POST   /api/v1/admin/notifications/send                 → send to specific user
POST   /api/v1/admin/notifications/broadcast            → broadcast to filtered users
GET    /api/v1/admin/notifications/templates             → notification templates

# Security
GET    /api/v1/admin/ip-blocks                          → list blocked IPs
POST   /api/v1/admin/ip-blocks                          → block IP
DELETE /api/v1/admin/ip-blocks/{id}                     → unblock IP
GET    /api/v1/admin/rate-limits                        → rate limit stats
GET    /api/v1/admin/rate-limits/{user_id}              → user's rate limit hits

# System (Extended)
GET    /api/v1/admin/crash-reports                      → list crash reports
GET    /api/v1/admin/crash-reports/{id}                 → crash report detail
DELETE /api/v1/admin/crash-reports/{id}                 → delete crash report
GET    /api/v1/admin/workers                            → worker status
GET    /api/v1/admin/config                             → system config (Super Admin only)

# Settings
GET    /api/v1/admin/settings                           → admin's personal settings
PUT    /api/v1/admin/settings                           → update personal settings
POST   /api/v1/admin/users/{id}/resend-verification     → resend email verification
```

---

## 5. Notification System

### 5.1 Notification Events

| Event | Trigger | Recipients | Channel |
|-------|---------|-----------|---------|
| `beta.request_created` | User requests beta access | Users with `beta.manage_requests` | in-app, email |
| `beta.request_approved` | Admin approves beta | User who requested | in-app, email |
| `beta.request_rejected` | Admin rejects beta | User who requested | in-app, email |
| `perm.granted` | Temp permission granted | Target user | in-app |
| `perm.expiring_soon` | 1h before expiry | Target user + Super Admins | in-app, email |
| `perm.expired` | Permission expired | Target user + Super Admin who granted | in-app, email |
| `perm.grant_extended` | Super Admin extends | Target user | in-app |
| `role.assigned` | Role assigned to user | Target user | in-app |
| `role.changed` | Role permissions modified | All users with that role | in-app |

### 5.2 User Notification Preferences

Stored as JSON on the User model:

```json
{
  "email": true,
  "sms": false,
  "push": true,
  "phone": "+905XXXXXXXXX",
  "beta_updates": true,
  "security_alerts": true,
  "marketing": false
}
```

Admin panel settings page allows toggling each channel.

### 5.3 Admin Broadcast

- Target filtering: by role, by status (active/suspended/banned), by activity date range
- Preview: "Bu bildirim N kullanıcıya gidecek"
- Schedule: immediate or delayed
- Channels: in-app notification, email, SMS (if phone available)

---

## 6. Audit Trail

Every permission check, every admin action, every state change is logged:

```
AuditLog {
  id: UUID PK
  user_id: UUID FK (users)       ← admin who performed action
  user_email: string
  action: string                  ← e.g. "users.ban", "roles.create"
  target_type: string | null      ← e.g. "user", "book", "role"
  target_id: string | null        ← UUID of target
  target_email: string | null     ← email of target user (if applicable)
  details: jsonb | null           ← arbitrary metadata
  ip_address: inet | null
  user_agent: string | null
  created_at: datetime
}
```

Audit Log UI Features:
- Search by action, user, target, date range
- Filter by event type
- Export to CSV
- Timeline view for a specific user or resource
- Retention policy: configurable (default 90 days)

---

## 7. Implementation Phases

### Phase 1: Foundation (Backend)
- [ ] Permission model + migration
- [ ] Role model + migration
- [ ] UserRole model + migration (with expires_at)
- [ ] BetaRequest model + migration
- [ ] AuditLog model (already exists — extend with permission fields)
- [ ] PermissionService (check, grant, revoke)
- [ ] RoleService (CRUD + import/export)
- [ ] BetaRequestService
- [ ] TempPermission worker
- [ ] NotificationService (extend existing)

### Phase 2: Admin Panel — Core
- [ ] Rewrite admin/index.html with new SPA structure
- [ ] Permission-aware API client (send user's permissions with every request)
- [ ] Permission-based UI rendering (hide buttons/links user can't use)
- [ ] Roles page (list/create/edit/import/export)
- [ ] Permissions page (matrix view)
- [ ] Users page (extend with roles, temporary permissions, messages, locations)

### Phase 3: Admin Panel — Full
- [ ] Beta requests page
- [ ] IP management page
- [ ] Rate limit page
- [ ] Crash reports page
- [ ] Workers page
- [ ] System config page (Super Admin)
- [ ] Settings page (notification preferences, beta toggle)
- [ ] Notification broadcast page
- [ ] Extended user detail pages (messages, locations, exchange history)

---

## 8. Security Constraints

- `super_admin` role cannot be deleted or have its permissions reduced
- An admin cannot remove their own `super_admin` role
- Temporary permissions cannot bypass the `super_admin` protection
- Audit log entries cannot be deleted (only archived after retention period)
- Imported roles are validated: unknown permissions are ignored with warnings
- Rate limiting applies to admin API endpoints separately from user endpoints
- Session tokens expire after 24 hours for admin panel

---

## 9. UI/UX Guidelines

- All text in Turkish (admin panel language)
- Permission-denied actions show disabled buttons with tooltip: "Yetkiniz yok"
- Loading states: skeleton screens (not spinners)
- Empty states: helpful messages with suggested actions
- Error states: retry button + error detail (collapsible)
- Responsive: sidebar collapses on < 768px, tables scroll horizontally
- Keyboard shortcuts: `Ctrl+R` refresh, `Escape` close modals, `/` focus search
- Bulk selection: checkboxes + "Seçilenlere Uygula" action bar
- Dark theme only (matching existing ocean theme)

---

## 10. Open Questions / Future

- WebSocket for real-time notifications in admin panel?
- Two-factor authentication for admin accounts?
- Admin action confirmation: require reason for destructive actions (already planned)?
- Rate limit thresholds: configurable per-role?
