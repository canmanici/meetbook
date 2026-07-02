"""Audit log tests."""

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.auth.models import AuditLog


@pytest.mark.asyncio
async def test_register_creates_audit_entry(
    client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    """Successful registration should create an audit log entry."""
    resp = await client.post(
        "/api/v1/auth/register",
        json={
            "email": "audit@example.com",
            "password": "securepass123",
            "name": "Audit User",
            "kvkk_consent": True,
        },
    )
    assert resp.status_code == 201

    result = await db_session.execute(
        select(AuditLog).where(AuditLog.event_type == "register_success")
    )
    entry = result.scalar_one_or_none()
    assert entry is not None
    assert entry.event_type == "register_success"


@pytest.mark.asyncio
async def test_login_failure_creates_audit_entry(
    client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    """Failed login should create an audit log entry."""
    import uuid

    unique_id = uuid.uuid7().hex[:8]
    email = f"auditfail-{unique_id}@example.com"
    await client.post(
        "/api/v1/auth/register",
        json={
            "email": email,
            "password": "securepass123",
            "name": "Audit User",
            "kvkk_consent": True,
        },
    )
    resp = await client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": "wrongpass"},
    )
    assert resp.status_code == 401

    result = await db_session.execute(select(AuditLog).where(AuditLog.event_type == "login_failed"))
    entry = result.scalar_one_or_none()
    assert entry is not None
    assert entry.event_type == "login_failed"


@pytest.mark.asyncio
async def test_audit_no_pii_in_metadata(
    client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    """Audit metadata should not contain passwords or tokens."""
    resp = await client.post(
        "/api/v1/auth/register",
        json={
            "email": "nopii@example.com",
            "password": "securepass123",
            "name": "No PII User",
            "kvkk_consent": True,
        },
    )
    assert resp.status_code == 201

    result = await db_session.execute(
        select(AuditLog).where(AuditLog.event_type == "register_success")
    )
    entry = result.scalar_one_or_none()
    assert entry is not None
    # Ensure no password or token in metadata
    if entry.metadata_:
        assert "password" not in entry.metadata_
        assert "token" not in entry.metadata_
