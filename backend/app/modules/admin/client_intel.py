"""Admin: where users sign in from — login history and new-user origins.

Built on data recorded per request by app/core/client_context.py:
- refresh_tokens rows = one per login / token rotation, with IP, device
  profile (device_info) and network (client.network: country/city/ISP/ASN);
- audit_log rows = auth events with the same snapshot in metadata.client.
"""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_session
from app.modules.auth.dependencies import get_admin_user
from app.modules.auth.models import AuditLog, RefreshToken, User

router = APIRouter(prefix="/admin", tags=["admin-ext"])

# Auth events shown in a user's sign-in history.
_LOGIN_EVENTS = ("register_success", "login_success", "login_failed", "token_reuse_detected")


class LoginEntry(BaseModel):
    at: datetime
    kind: str  # session | register_success | login_success | login_failed | …
    ip: str | None = None
    user_agent: str | None = None
    device: dict[str, Any] | None = None
    network: dict[str, Any] | None = None
    active: bool | None = None  # sessions only: not revoked and not expired


class LoginSummary(BaseModel):
    distinct_ips: int
    distinct_devices: int
    countries: list[str]
    isps: list[str]
    last_ip: str | None = None
    last_seen_at: datetime | None = None


class UserLoginsResponse(BaseModel):
    items: list[LoginEntry]
    summary: LoginSummary


class NewUserItem(BaseModel):
    id: uuid.UUID
    name: str | None
    email: str
    created_at: datetime
    status: str
    signup_ip: str | None = None
    device: dict[str, Any] | None = None
    network: dict[str, Any] | None = None
    sessions: int = 0


class NewUsersResponse(BaseModel):
    days: int
    total: int
    items: list[NewUserItem]
    by_platform: dict[str, int]
    by_isp: dict[str, int]
    by_city: dict[str, int]


def _device_key(d: dict[str, Any] | None) -> str | None:
    if not d:
        return None
    return str(d.get("device_id") or d.get("model_code") or d.get("device_model") or "") or None


@router.get("/users/{user_id}/logins", response_model=UserLoginsResponse)
async def user_logins(
    user_id: uuid.UUID,
    limit: int = Query(default=100, ge=1, le=500),
    _: User = Depends(get_admin_user),
    session: AsyncSession = Depends(get_session),
) -> UserLoginsResponse:
    user = await session.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")

    now = datetime.now(UTC)
    tokens = (
        (
            await session.execute(
                select(RefreshToken)
                .where(RefreshToken.user_id == user_id)
                .order_by(RefreshToken.created_at.desc())
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )
    audits = (
        (
            await session.execute(
                select(AuditLog)
                .where(AuditLog.user_id == user_id, AuditLog.event_type.in_(_LOGIN_EVENTS))
                .order_by(AuditLog.created_at.desc())
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )
    # Failed logins carry no user_id (the password was wrong) — match by email.
    failed = (
        (
            await session.execute(
                select(AuditLog)
                .where(
                    AuditLog.event_type == "login_failed",
                    AuditLog.user_id.is_(None),
                    func.lower(AuditLog.metadata_["email"].astext) == user.email.lower(),
                )
                .order_by(AuditLog.created_at.desc())
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )

    items: list[LoginEntry] = []
    for t in tokens:
        net = (t.client or {}).get("network") if isinstance(t.client, dict) else None
        items.append(
            LoginEntry(
                at=t.created_at,
                kind="session",
                ip=str(t.ip_address) if t.ip_address else None,
                user_agent=t.user_agent,
                device=t.device_info or None,
                network=net,
                active=t.revoked_at is None and t.expires_at > now,
            )
        )
    for a in [*audits, *failed]:
        client = (a.metadata_ or {}).get("client") if isinstance(a.metadata_, dict) else None
        items.append(
            LoginEntry(
                at=a.created_at,
                kind=a.event_type,
                ip=str(a.ip_address) if a.ip_address else None,
                user_agent=a.user_agent,
                device=(client or {}).get("device") or None,
                network=(client or {}).get("network") or None,
            )
        )
    items.sort(key=lambda e: e.at, reverse=True)
    items = items[:limit]

    ips = {e.ip for e in items if e.ip}
    devices = {k for e in items if (k := _device_key(e.device))}
    countries = sorted(
        {str(e.network["country"]) for e in items if e.network and e.network.get("country")}
    )
    isps = sorted({str(e.network["isp"]) for e in items if e.network and e.network.get("isp")})
    last = next((e for e in items if e.kind != "login_failed" and e.ip), None)
    return UserLoginsResponse(
        items=items,
        summary=LoginSummary(
            distinct_ips=len(ips),
            distinct_devices=len(devices),
            countries=countries,
            isps=isps,
            last_ip=last.ip if last else None,
            last_seen_at=last.at if last else None,
        ),
    )


@router.get("/metrics/new-users", response_model=NewUsersResponse)
async def new_users(
    days: int = Query(default=30, ge=1, le=365),
    limit: int = Query(default=50, ge=1, le=200),
    _: User = Depends(get_admin_user),
    session: AsyncSession = Depends(get_session),
) -> NewUsersResponse:
    since = datetime.now(UTC) - timedelta(days=days)
    total = (
        await session.execute(
            select(func.count()).select_from(User).where(User.created_at >= since)
        )
    ).scalar_one()
    users = (
        (
            await session.execute(
                select(User)
                .where(User.created_at >= since)
                .order_by(User.created_at.desc())
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )
    ids = [u.id for u in users]

    # First issued token per user = where they signed up / first signed in.
    first_tokens: dict[uuid.UUID, RefreshToken] = {}
    session_counts: dict[uuid.UUID, int] = {}
    if ids:
        rows = (
            (
                await session.execute(
                    select(RefreshToken)
                    .where(RefreshToken.user_id.in_(ids))
                    .order_by(RefreshToken.user_id, RefreshToken.created_at.asc())
                )
            )
            .scalars()
            .all()
        )
        for t in rows:
            first_tokens.setdefault(t.user_id, t)
            session_counts[t.user_id] = session_counts.get(t.user_id, 0) + 1

    items: list[NewUserItem] = []
    by_platform: dict[str, int] = {}
    by_isp: dict[str, int] = {}
    by_city: dict[str, int] = {}
    for u in users:
        first = first_tokens.get(u.id)
        device = (first.device_info or None) if first else None
        net = (
            (first.client or {}).get("network") if first and isinstance(first.client, dict) else None
        ) or None
        items.append(
            NewUserItem(
                id=u.id,
                name=u.name,
                email=u.email,
                created_at=u.created_at,
                status=u.status.value if hasattr(u.status, "value") else str(u.status),
                signup_ip=str(first.ip_address) if first and first.ip_address else None,
                device=device,
                network=net,
                sessions=session_counts.get(u.id, 0),
            )
        )
        plat = (device or {}).get("os") or "Bilinmiyor"
        by_platform[plat] = by_platform.get(plat, 0) + 1
        if net and net.get("isp"):
            by_isp[net["isp"]] = by_isp.get(net["isp"], 0) + 1
        if net and net.get("city"):
            by_city[net["city"]] = by_city.get(net["city"], 0) + 1

    return NewUsersResponse(
        days=days,
        total=total,
        items=items,
        by_platform=by_platform,
        by_isp=dict(sorted(by_isp.items(), key=lambda kv: -kv[1])[:10]),
        by_city=dict(sorted(by_city.items(), key=lambda kv: -kv[1])[:10]),
    )
