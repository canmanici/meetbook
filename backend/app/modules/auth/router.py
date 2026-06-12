"""Auth endpoints."""

import redis.asyncio as aioredis
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.db import get_session
from app.core.throttle import LoginThrottle
from app.modules.auth.dependencies import get_current_user
from app.modules.auth.models import User
from app.modules.auth.schemas import (
    AuthTokensResponse,
    LoginRequest,
    LogoutRequest,
    MessageResponse,
    PasswordResetConfirmRequest,
    PasswordResetRequest,
    RefreshRequest,
    RegisterRequest,
    TokenResponse,
)
from app.modules.auth.service import AuthError, AuthService

router = APIRouter(prefix="/auth", tags=["auth"])


def _get_service(session: AsyncSession = Depends(get_session)) -> AuthService:
    return AuthService(session)


def _get_throttle() -> LoginThrottle:
    return LoginThrottle(aioredis.from_url(get_settings().redis_url))


@router.post("/register", response_model=AuthTokensResponse, status_code=201)
async def register(
    body: RegisterRequest,
    service: AuthService = Depends(_get_service),
) -> AuthTokensResponse:
    try:
        return await service.register(body.email, body.password, body.name, body.kvkk_consent)
    except AuthError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)


@router.post("/login", response_model=TokenResponse)
async def login(
    body: LoginRequest,
    request: Request,
    service: AuthService = Depends(_get_service),
    throttle: LoginThrottle = Depends(_get_throttle),
) -> TokenResponse:
    try:
        ip = request.client.host if request.client else "127.0.0.1"
        return await service.login(body.email, body.password, throttle, ip)
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
        return await service.confirm_password_reset(body.token, body.new_password)
    except AuthError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)
