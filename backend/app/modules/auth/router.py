"""Auth endpoints."""

import uuid
from typing import Any

import redis.asyncio as aioredis
from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, Response, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.client_ip import resolve_client_ip
from app.core.config import get_settings
from app.core.db import get_session
from app.core.throttle import LoginThrottle
from app.modules.auth.dependencies import get_current_user
from app.modules.auth.models import User
from app.modules.auth.schemas import (
    AuthTokensResponse,
    DeleteAccountRequest,
    GoogleLoginRequest,
    GoogleLoginResponse,
    LoginRequest,
    LogoutRequest,
    MeResponse,
    MessageResponse,
    PasswordResetConfirmRequest,
    PasswordResetRequest,
    RefreshRequest,
    RegisterRequest,
    SessionListResponse,
    SessionView,
    TokenResponse,
    UpdateMeRequest,
    UsernameAvailabilityResponse,
    UserPublicProfile,
    UserSearchResponse,
    VerifyEmailRequest,
    VouchListResponse,
    VouchRequest,
    VouchView,
)
from app.modules.auth.service import MAX_AVATAR_BYTES, AuthError, AuthService

router = APIRouter(prefix="/auth", tags=["auth"])


def _get_service(session: AsyncSession = Depends(get_session)) -> AuthService:
    return AuthService(session)


def _get_client_ip(request: Request) -> str:
    peer = request.client.host if request.client else None
    return resolve_client_ip(peer, request.headers.get("X-Forwarded-For"))


def _get_throttle() -> LoginThrottle:
    return LoginThrottle(aioredis.from_url(get_settings().redis_url))


@router.post("/register", response_model=AuthTokensResponse, status_code=201)
async def register(
    body: RegisterRequest,
    service: AuthService = Depends(_get_service),
) -> AuthTokensResponse:
    try:
        return await service.register(
            body.email,
            body.password,
            body.name,
            body.kvkk_consent,
            username=body.username,
        )
    except AuthError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)


@router.get("/username-available", response_model=UsernameAvailabilityResponse)
async def check_username_available(
    username: str = Query(..., min_length=3, max_length=30),
    service: AuthService = Depends(_get_service),
) -> UsernameAvailabilityResponse:
    """Live-check while typing on register / profile edit — no auth required
    since it must work before the account exists."""
    available = await service.is_username_available(username)
    return UsernameAvailabilityResponse(available=available)


@router.post("/login", response_model=TokenResponse)
async def login(
    body: LoginRequest,
    request: Request,
    service: AuthService = Depends(_get_service),
    throttle: LoginThrottle = Depends(_get_throttle),
) -> TokenResponse:
    try:
        ip = _get_client_ip(request)
        return await service.login(body.email, body.password, throttle, ip)
    except AuthError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)


@router.post("/google", response_model=GoogleLoginResponse)
async def login_with_google(
    body: GoogleLoginRequest,
    service: AuthService = Depends(_get_service),
) -> GoogleLoginResponse:
    """Sign in (or sign up) with a Google ID token from the app."""
    try:
        return await service.login_with_google(body.id_token, body.kvkk_consent)
    except AuthError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)


@router.post("/refresh", response_model=TokenResponse)
async def refresh(
    body: RefreshRequest,
    service: AuthService = Depends(_get_service),
) -> TokenResponse:
    try:
        return await service.refresh(body.refresh_token)
    except AuthError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)


@router.post("/logout", status_code=204)
async def logout(
    body: LogoutRequest,
    user: User = Depends(get_current_user),
    service: AuthService = Depends(_get_service),
) -> Response:
    await service.logout(user.id, body.refresh_token)
    return Response(status_code=204)


@router.post("/password-reset-request", response_model=MessageResponse)
async def password_reset_request(
    body: PasswordResetRequest,
    service: AuthService = Depends(_get_service),
) -> MessageResponse:
    return await service.request_password_reset(body.email)


@router.post("/password-reset-confirm", response_model=MessageResponse)
async def password_reset_confirm(
    body: PasswordResetConfirmRequest,
    service: AuthService = Depends(_get_service),
) -> MessageResponse:
    try:
        return await service.confirm_password_reset(
            body.new_password, token=body.token, email=body.email, code=body.code
        )
    except AuthError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)


@router.post("/verify-email", response_model=MessageResponse)
async def verify_email(
    body: VerifyEmailRequest,
    user: User = Depends(get_current_user),
    service: AuthService = Depends(_get_service),
) -> MessageResponse:
    try:
        return await service.verify_email(user.id, body.code)
    except AuthError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)


@router.post("/verify-email/resend", response_model=MessageResponse)
async def resend_verification_email(
    user: User = Depends(get_current_user),
    service: AuthService = Depends(_get_service),
) -> MessageResponse:
    try:
        return await service.resend_verification(user.id)
    except AuthError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)


@router.get("/me", response_model=MeResponse)
async def get_me(
    user: User = Depends(get_current_user),
    service: AuthService = Depends(_get_service),
) -> MeResponse:
    try:
        return await service.get_me(user.id)
    except AuthError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)


@router.patch("/me", response_model=MeResponse)
async def update_me(
    body: UpdateMeRequest,
    user: User = Depends(get_current_user),
    service: AuthService = Depends(_get_service),
) -> MeResponse:
    try:
        return await service.update_me(user.id, body)
    except AuthError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)


@router.delete("/me", status_code=204)
async def delete_my_account(
    body: DeleteAccountRequest,
    user: User = Depends(get_current_user),
    service: AuthService = Depends(_get_service),
) -> Response:
    try:
        await service.delete_account(user.id, body.password)
    except AuthError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)
    return Response(status_code=204)


@router.post("/me/avatar", response_model=dict)
async def upload_my_avatar(
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
    service: AuthService = Depends(_get_service),
) -> dict[str, Any]:
    # At most limit+1 bytes: the service rejects oversize without us buffering it all.
    contents = await file.read(MAX_AVATAR_BYTES + 1)
    try:
        url = await service.upload_avatar(user.id, contents, file.content_type or "image/jpeg")
        return {"avatar_url": url}
    except AuthError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)


@router.get("/users/search", response_model=UserSearchResponse)
async def search_users(
    q: str = Query(..., min_length=1, max_length=100),
    user: User = Depends(get_current_user),
    service: AuthService = Depends(_get_service),
) -> UserSearchResponse:
    """Find other users by name — used by the in-app user directory search."""
    items = await service.search_users(user.id, q)
    return UserSearchResponse(items=items)


@router.get("/users/{user_id}", response_model=UserPublicProfile)
async def get_user_profile(
    user_id: uuid.UUID,
    user: User = Depends(get_current_user),
    service: AuthService = Depends(_get_service),
) -> UserPublicProfile:
    try:
        return await service.get_user_profile(user_id)
    except AuthError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)


# ---------------------------------------------------------------------------
# B12: Active sessions / devices
# ---------------------------------------------------------------------------


@router.get("/me/sessions", response_model=SessionListResponse)
async def list_sessions(
    user: User = Depends(get_current_user),
    service: AuthService = Depends(_get_service),
) -> SessionListResponse:
    tokens = await service.list_sessions(user.id)
    items = [
        SessionView(
            id=t.id,
            device_info=t.device_info,
            created_at=t.created_at,
            is_current=(idx == 0),
        )
        for idx, t in enumerate(tokens)
    ]
    return SessionListResponse(items=items)


@router.delete("/me/sessions/{session_id}", status_code=204)
async def revoke_session(
    session_id: uuid.UUID,
    user: User = Depends(get_current_user),
    service: AuthService = Depends(_get_service),
) -> Response:
    try:
        await service.revoke_session(user.id, session_id)
    except AuthError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)
    return Response(status_code=204)


# ---------------------------------------------------------------------------
# B27: Reading history export
# ---------------------------------------------------------------------------


@router.get("/me/reading-history/export")
async def export_reading_history(
    user: User = Depends(get_current_user),
    service: AuthService = Depends(_get_service),
) -> dict[str, Any]:
    try:
        return await service.export_reading_history(user.id)
    except AuthError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)


# ---------------------------------------------------------------------------
# B25: Vouching system
# ---------------------------------------------------------------------------


@router.post("/users/{user_id}/vouch", response_model=VouchView, status_code=201)
async def create_vouch(
    user_id: uuid.UUID,
    body: VouchRequest,
    user: User = Depends(get_current_user),
    service: AuthService = Depends(_get_service),
) -> VouchView:
    try:
        return await service.create_vouch(user.id, user_id, body.note)
    except AuthError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)


@router.get("/users/{user_id}/vouches", response_model=VouchListResponse)
async def list_user_vouches(
    user_id: uuid.UUID,
    user: User = Depends(get_current_user),
    service: AuthService = Depends(_get_service),
) -> VouchListResponse:
    try:
        return await service.list_vouches(user_id)
    except AuthError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)
