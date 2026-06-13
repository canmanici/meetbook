# MeetBook

Location-aware book exchange app for Turkey. **Read `Meetbook.md` first** — it explains
what we're building and why; `docs/` holds the detailed specs.

## Local development

```bash
cp .env.example .env

# infra
docker compose up -d --wait        # PostGIS + Redis

# backend (http://localhost:8000, docs at /api/docs)
cd backend
cp ../.env.example .env
uv sync
uv run alembic upgrade head
uv run fastapi dev app/main.py

# mobile
cd mobile
npm install
npx expo start
```

## Verify your setup

```bash
curl http://localhost:8000/api/v1/health   # {"status":"ok","postgis":"..."}
cd backend && uv run pytest                # smoke tests (need docker services up)
```
