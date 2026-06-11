# Deployment Plan

## Environments

| Env | Purpose | Infra |
|---|---|---|
| local | development | docker-compose (postgres+postgis, redis), `uv run fastapi dev`, Expo Go / dev build |
| staging | pre-release testing, load tests | same topology as prod, smaller sizes; seeded data |
| production | real users | below |

## Backend (production)

- **Host:** start on Railway or Render (managed Postgres with PostGIS + managed Redis +
  container deploy in one place); migrate to AWS/GCP only when scale demands. Decision driver:
  a junior team should not start with raw VPS ops.
- **Topology:** 2× FastAPI containers (uvicorn) behind the platform load balancer
  (sticky not required — WS fan-out goes through Redis pub/sub), 1× worker container
  (APScheduler), managed Postgres 16 + PostGIS, managed Redis, S3-compatible bucket
  (Cloudflare R2 — no egress fees) for images.
- **TLS/HSTS** terminated at the platform edge. Custom domain `api.meetbook.app`.
- **Migrations:** release step runs `alembic upgrade head` before new containers receive
  traffic. Rollback = redeploy previous image (migrations must be backward-compatible one
  version — additive first, destructive later).
- **Secrets:** platform secret store. Separate Google Places keys per env with separate
  quotas. JWT secret rotated via dual-key support (`JWT_SECRETS` list: verify with all, sign with first).
- **Backups:** daily automated Postgres snapshots, 30-day retention, encrypted; quarterly
  restore drill on staging.

## Mobile

- **EAS Build** profiles: `development` (dev client), `preview` (internal/TestFlight/Play
  internal), `production`.
- **EAS Update (OTA):** JS-only fixes ship over the air; native changes (new permissions,
  SDK bumps) require store builds.
- Store metadata TR + EN; screenshots from the design system; privacy labels declare
  location use ("used to show nearby books and arrange meetups — never shared precisely").
- App signing via EAS-managed credentials.

## Monitoring & Operations

- **Sentry** backend + mobile, release-tagged, PII scrubbing on.
- **Structured JSON logs** → platform log aggregation; security events also in `audit_log` table.
- **Dashboards/alerts:** API p95 & error rate, DB CPU/connections, Redis memory, WS
  connection count, worker last-run age (a silent dead worker breaks KVKK cleanup —
  alert if `cleanup_locations` hasn't run in 3 h).
- **Cost watch:** Google Places daily spend alert at 80% of budget; cache hit-rate metric;
  R2/storage growth.
- **Uptime:** external ping on `/api/v1/health` (checks DB + Redis connectivity).

## Launch Checklist

- [ ] Staging soak: 1 week of beta traffic, zero Sentry criticals
- [ ] Load test targets met on staging (see TESTING_QA_PLAN.md)
- [ ] Backup restore drill performed
- [ ] KVKK privacy policy + terms published and linked in-app
- [ ] Rate limits verified in prod config
- [ ] Store review passed (both stores) with location-permission justification
- [ ] On-call: who gets paged, runbook for the top 5 failure modes
