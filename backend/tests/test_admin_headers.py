"""The admin panel page is served with anti-XSS / anti-clickjacking headers."""

import httpx
import pytest

pytestmark = pytest.mark.asyncio


async def test_admin_panel_is_served_with_security_headers(client: httpx.AsyncClient) -> None:
    resp = await client.get("/admin/index.html")
    if resp.status_code == 404:
        pytest.skip("admin/index.html not present in this checkout")
    assert resp.status_code == 200
    csp = resp.headers["content-security-policy"]
    # Nothing may be sent to, or loaded from, another origin.
    assert "connect-src 'self'" in csp
    assert "img-src 'self' data: blob:" in csp
    assert "frame-ancestors 'none'" in csp
    assert "object-src 'none'" in csp
    assert resp.headers["x-frame-options"] == "DENY"
    assert resp.headers["x-content-type-options"] == "nosniff"
    assert resp.headers["referrer-policy"] == "no-referrer"
