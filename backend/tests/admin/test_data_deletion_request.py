"""In-app KVKK data deletion request (Settings → Verilerimin silinmesini iste)."""

from datetime import UTC, datetime

import httpx

from app.core.policy import add_business_days, current_policy_version


def test_business_days_skip_weekends() -> None:
    fri = datetime(2026, 9, 25, 10, tzinfo=UTC)  # Friday
    assert add_business_days(fri, 1).weekday() == 0  # → Monday
    assert (add_business_days(fri, 30) - fri).days == 42  # 30 working days = 6 weeks


def test_policy_version_comes_from_version_file() -> None:
    assert current_policy_version() == "1.2"


async def test_deletion_request_flow(client: httpx.AsyncClient, register_user) -> None:  # type: ignore[no-untyped-def]
    u = await register_user("del@example.com", "Del")
    h = u["headers"]

    r = await client.get("/api/v1/privacy/deletion-request", headers=h)
    assert r.status_code == 200 and r.json() is None

    r = await client.post("/api/v1/privacy/deletion-request", json={"note": "lütfen"}, headers=h)
    assert r.status_code == 201, r.text
    first = r.json()
    assert first["status"] == "open" and not first["already_open"]
    created = datetime.fromisoformat(first["created_at"])
    due = datetime.fromisoformat(first["due_at"])
    assert 40 <= (due - created).days <= 44

    # a second tap doesn't create a duplicate
    r = await client.post("/api/v1/privacy/deletion-request", json={}, headers=h)
    assert r.json()["reference"] == first["reference"] and r.json()["already_open"]

    r = await client.get("/api/v1/privacy/deletion-request", headers=h)
    assert r.json()["reference"] == first["reference"]

    # requires sign-in
    r = await client.post("/api/v1/privacy/deletion-request", json={})
    assert r.status_code == 401
