import httpx

from app.main import create_app


async def test_health_reports_db_and_redis() -> None:
    """Phase 0 smoke test: requires docker compose services running."""
    app = create_app()
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/api/v1/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert body["postgis"]  # PostGIS extension actually answers
