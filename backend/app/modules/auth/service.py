"""Auth business logic — register, login, refresh, logout, password reset."""

import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_event
from app.core.config import get_settings
from app.core.security import (
    create_access_token,
    create_refresh_token,
    generate_opaque_token,
    hash_password,
    hash_token,
    verify_password,
)
from app.core.throttle import LoginThrottle
from app.modules.auth.models import UserStatus
from app.modules.auth.repository import AuthRepository
from app.modules.auth.schemas import (
    AuthTokensResponse,
    MeResponse,
    MessageResponse,
    TokenResponse,
    UpdateMeRequest,
    UserPublic,
)

CURRENT_KVKK_POLICY_VERSION = "1.0"


class AuthError(Exception):
    def __init__(self, message: str, status_code: int = 400) -> None:
        self.message = message
        self.status_code = status_code


class AuthService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.repo = AuthRepository(session)

    async def register(
        self, email: str, password: str, name: str, kvkk_consent: bool
    ) -> AuthTokensResponse:
        if kvkk_consent is not True:
            raise AuthError("KVKK consent is required", 422)

        # Check duplicate email
        existing = await self.repo.get_user_by_email(email)
        if existing:
            raise AuthError("Email already registered", 409)

        # Create user + credentials
        pw_hash = hash_password(password)
        user, _ = await self.repo.create_user(email, name, pw_hash)

        now = datetime.now(UTC)
        user.email_verified_at = now
        user.kvkk_consent_at = now
        user.kvkk_policy_version = CURRENT_KVKK_POLICY_VERSION

        # Generate tokens
        raw_token, token_hashed, family_id = create_refresh_token()
        settings = get_settings()
        expires_at = datetime.now(UTC) + timedelta(days=settings.refresh_token_ttl_days)
        await self.repo.create_refresh_token(
            user.id, token_hashed, family_id, expires_at
        )

        access_token = create_access_token(str(user.id))
        await log_event(self.session, "register_success", user_id=user.id)
        await self.session.commit()

        return AuthTokensResponse(
            user_id=user.id,
            access_token=access_token,
            refresh_token=raw_token,
            user=UserPublic(id=user.id, email=user.email, name=user.name),
        )

    async def login(
        self,
        email: str,
        password: str,
        throttle: LoginThrottle | None = None,
        ip: str = "127.0.0.1",
    ) -> TokenResponse:
        # Check throttle if provided
        if throttle:
            allowed, retry_after = await throttle.check(email, ip)
            if not allowed:
                raise AuthError(
                    f"Too many failed attempts. Try again in {retry_after} seconds",
                    429,
                )

        # Get user
        user = await self.repo.get_user_by_email(email)
        if not user:
            await log_event(self.session, "login_failed", metadata={"email": email})
            raise AuthError("Email or password is incorrect", 401)

        # Check status
        if user.status != UserStatus.active:
            raise AuthError("Account is not active", 401)

        # Get credentials
        credential = await self.repo.get_credential_by_user_id(user.id)
        if not credential:
            raise AuthError("Email or password is incorrect", 401)

        # Verify password
        if not verify_password(password, credential.password_hash):
            if throttle:
                await throttle.record_failure(email, ip)
            await log_event(self.session, "login_failed", metadata={"email": email})
            raise AuthError("Email or password is incorrect", 401)

        # Generate tokens
        raw_token, token_hashed, family_id = create_refresh_token()
        settings = get_settings()
        expires_at = datetime.now(UTC) + timedelta(days=settings.refresh_token_ttl_days)
        await self.repo.create_refresh_token(
            user.id, token_hashed, family_id, expires_at
        )

        # Update last active
        await self.repo.update_last_active(user.id)

        access_token = create_access_token(str(user.id))
        await log_event(self.session, "login_success", user_id=user.id)
        await self.session.commit()

        return TokenResponse(
            access_token=access_token,
            refresh_token=raw_token,
            user=UserPublic(id=user.id, email=user.email, name=user.name),
        )

    async def refresh(self, refresh_token: str) -> TokenResponse:
        token_hashed = hash_token(refresh_token)
        rt = await self.repo.get_refresh_token(token_hashed)

        if not rt:
            raise AuthError("Invalid refresh token", 401)

        # Check if revoked (reuse detection)
        if rt.revoked_at is not None:
            # Token reuse detected — revoke entire family
            await self.repo.revoke_family(rt.family_id)
            await log_event(self.session, "token_reuse_detected", user_id=rt.user_id)
            await self.session.commit()
            raise AuthError("Token reuse detected — please log in again", 401)

        # Check expiry
        if rt.expires_at < datetime.now(UTC):
            raise AuthError("Refresh token expired", 401)

        # Revoke old token
        await self.repo.revoke_token(token_hashed)

        # Issue new token with same family_id
        new_raw, new_hashed, _ = create_refresh_token()
        settings = get_settings()
        new_expires = datetime.now(UTC) + timedelta(days=settings.refresh_token_ttl_days)
        await self.repo.create_refresh_token(
            rt.user_id, new_hashed, rt.family_id, new_expires
        )

        access_token = create_access_token(str(rt.user_id))
        await log_event(self.session, "token_refreshed", user_id=rt.user_id)
        await self.session.commit()

        user = await self.repo.get_user_by_id(rt.user_id)
        if user is None:
            raise AuthError("User not found", 401)

        return TokenResponse(
            access_token=access_token,
            refresh_token=new_raw,
            user=UserPublic(id=user.id, email=user.email, name=user.name),
        )

    async def logout(
        self, user_id: uuid.UUID, refresh_token: str | None = None
    ) -> None:
        if refresh_token:
            token_hashed = hash_token(refresh_token)
            rt = await self.repo.get_refresh_token(token_hashed)
            if rt and rt.user_id == user_id:
                await self.repo.revoke_family(rt.family_id)
        await log_event(self.session, "logout", user_id=user_id)
        await self.session.commit()

    async def request_password_reset(self, email: str) -> MessageResponse:
        user = await self.repo.get_user_by_email(email)
        if user:
            raw_token = generate_opaque_token(32)
            token_hashed = hash_token(raw_token)
            expires_at = datetime.now(UTC) + timedelta(minutes=15)
            await self.repo.create_password_reset_token(
                user.id, token_hashed, expires_at
            )
            await log_event(
                self.session, "password_reset_requested", user_id=user.id
            )
            await self.session.commit()
            # In production: send email with raw_token
            # For now: log to console
            print(f"[PASSWORD RESET] Token for {email}: {raw_token}")

        # Always return success (don't reveal email existence)
        return MessageResponse(message="If the email exists, a reset link has been sent")

    async def confirm_password_reset(
        self, token: str, new_password: str
    ) -> MessageResponse:
        token_hashed = hash_token(token)
        prt = await self.repo.get_password_reset_token(token_hashed)

        if not prt or prt.used_at is not None:
            raise AuthError("Invalid or expired reset token", 400)

        if prt.expires_at < datetime.now(UTC):
            raise AuthError("Reset token expired", 400)

        # Update password
        user = await self.repo.get_user_by_id(prt.user_id)
        if not user:
            raise AuthError("Invalid reset token", 400)

        credential = await self.repo.get_credential_by_user_id(user.id)
        if credential:
            credential.password_hash = hash_password(new_password)

        # Mark token used
        await self.repo.mark_password_reset_used(prt.id)

        # Revoke all refresh tokens
        await self.repo.revoke_all_user_tokens(user.id)

        await log_event(self.session, "password_reset_completed", user_id=user.id)
        await self.session.commit()
        return MessageResponse(message="Password has been reset")

    async def get_me(self, user_id: uuid.UUID) -> MeResponse:
        user = await self.repo.get_user_by_id(user_id)
        if user is None:
            raise AuthError("Not found", 404)
        return MeResponse(
            id=user.id,
            email=user.email,
            name=user.name,
            trusted_contact_name=user.trusted_contact_name,
            trusted_contact_phone=user.trusted_contact_phone,
        )

    async def update_me(self, user_id: uuid.UUID, body: UpdateMeRequest) -> MeResponse:
        user = await self.repo.get_user_by_id(user_id)
        if user is None:
            raise AuthError("Not found", 404)
        user.trusted_contact_name = body.trusted_contact_name
        user.trusted_contact_phone = body.trusted_contact_phone
        await self.session.commit()
        return await self.get_me(user_id)
