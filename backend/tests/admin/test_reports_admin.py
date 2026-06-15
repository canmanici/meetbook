"""Proof-of-work: report filing, admin queue, and resolution notifications (Phase 7 DoD)."""

from collections.abc import Awaitable, Callable
from typing import Any

import httpx
import pytest


@pytest.mark.asyncio
async def test_filed_report_appears_in_admin_queue_and_resolve_notifies_reporter(
    client: httpx.AsyncClient,
    register_user: Callable[[str, str], Awaitable[dict[str, Any]]],
    make_admin: Callable[[str], Awaitable[None]],
) -> None:
    reporter = await register_user("reporter@example.com", "Reporter")
    target = await register_user("target@example.com", "Target")
    admin = await register_user("admin@example.com", "Admin")
    await make_admin(admin["user_id"])

    report_resp = await client.post(
        "/api/v1/reports",
        json={
            "target_type": "user",
            "target_id": target["user_id"],
            "reason": "Spam messages",
        },
        headers=reporter["headers"],
    )
    assert report_resp.status_code == 201
    report = report_resp.json()
    assert report["status"] == "open"

    # Non-admins are forbidden.
    forbidden = await client.get("/api/v1/admin/reports", headers=reporter["headers"])
    assert forbidden.status_code == 403

    queue = await client.get("/api/v1/admin/reports", headers=admin["headers"])
    assert queue.status_code == 200
    items = queue.json()["items"]
    assert any(item["id"] == report["id"] for item in items)
    queued = next(item for item in items if item["id"] == report["id"])
    assert queued["content_snapshot"]["id"] == target["user_id"]
    assert queued["content_snapshot"]["email"] == "target@example.com"

    claim = await client.post(
        f"/api/v1/admin/reports/{report['id']}/claim", headers=admin["headers"]
    )
    assert claim.status_code == 200
    assert claim.json()["status"] == "reviewing"
    assert claim.json()["moderator_id"] == admin["user_id"]

    resolve = await client.post(
        f"/api/v1/admin/reports/{report['id']}/resolve",
        json={"status": "resolved", "moderator_notes": "User warned"},
        headers=admin["headers"],
    )
    assert resolve.status_code == 200
    assert resolve.json()["status"] == "resolved"
    assert resolve.json()["resolved_at"] is not None

    notifications = await client.get("/api/v1/notifications", headers=reporter["headers"])
    assert notifications.status_code == 200
    items = notifications.json()["items"]
    assert len(items) == 1
    assert items[0]["type"] == "report_resolved"
    assert items[0]["payload"]["report_id"] == report["id"]
    assert items[0]["payload"]["status"] == "resolved"
