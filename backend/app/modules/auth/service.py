"""Auth business logic — register, login, refresh, logout, password reset."""

import hmac
import logging
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.policy import current_policy_version
from app.core.audit import log_event
from app.core.config import get_settings
from app.core.google_auth import GoogleAuthError, verify_google_id_token
from app.core.mailer import code_email, send_mail
from app.core.maintenance import LOADTEST_EMAIL_DOMAIN
from app.core.security import (
    create_access_token,
    create_refresh_token,
    hash_password,
    hash_token,
    verify_password,
)
from app.core.throttle import LoginThrottle
from app.modules.auth.models import (
    EmailCode,
    EmailCodePurpose,
    RefreshToken,
    User,
    UserCredential,
    UserStatus,
    Vouch,
)
from app.modules.auth.repository import AuthRepository
from app.modules.auth.schemas import (
    RESERVED_USERNAMES,
    AuthTokensResponse,
    GoogleLoginResponse,
    MeResponse,
    MessageResponse,
    TokenResponse,
    UpdateMeRequest,
    UserPublic,
    UserPublicProfile,
    UserSearchResult,
    VouchListResponse,
    VouchView,
)

CODE_TTL_MINUTES = 15
MAX_CODE_ATTEMPTS = 5
MAX_AVATAR_BYTES = 5 * 1024 * 1024

CODE_RESEND_COOLDOWN_SECONDS = 60

EDU_DOMAIN_SUFFIX = ".edu.tr"

logger = logging.getLogger(__name__)


def is_edu_email(email: str) -> bool:
    """A Turkish university address: something@<anything>.edu.tr."""
    local, _, domain = email.strip().lower().rpartition("@")
    return bool(local) and domain.endswith(EDU_DOMAIN_SUFFIX) and domain != EDU_DOMAIN_SUFFIX[1:]


def _code_hash(user_id: uuid.UUID, code: str) -> str:
    # Salted with the user id: identical codes for two users hash differently.
    return hash_token(f"{user_id}:{code}")


class AuthError(Exception):
    def __init__(self, message: str, status_code: int = 400) -> None:
        self.message = message
        self.status_code = status_code


class AuthService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.repo = AuthRepository(session)

    async def register(
        self,
        email: str,
        password: str,
        name: str,
        kvkk_consent: bool,
        username: str | None = None,
    ) -> AuthTokensResponse:
        if kvkk_consent is not True:
            raise AuthError("KVKK consent is required", 422)
        # Reserved for synthetic load-test accounts, which get purged.
        if email.lower().endswith("@" + LOADTEST_EMAIL_DOMAIN):
            raise AuthError("Email domain not allowed", 422)

        # Check duplicate email
        existing = await self.repo.get_user_by_email(email)
        if existing:
            raise AuthError("Email already registered", 409)

        if username is not None:
            # Caller picked a handle explicitly — it must be free and not reserved.
            if username.lower() in RESERVED_USERNAMES:
                raise AuthError("Username is reserved", 409)
            if await self.repo.get_user_by_username(username):
                raise AuthError("Username already taken", 409)
        else:
            # No handle picked (e.g. legacy/API callers) — derive one from the
            # name so the NOT NULL/UNIQUE column is always satisfiable.
            username = await self._generate_username(name)

        # Create user + credentials
        pw_hash = hash_password(password)
        user, _ = await self.repo.create_user(email, name, username, pw_hash)

        now = datetime.now(UTC)
        settings = get_settings()
        if settings.auto_verify_email:
            # Verification switched off (demo) or dev without SMTP — see
            # Settings.auto_verify_email.
            logger.info("E-mail verification not required — verifying %s at sign-up", user.email)
            user.email_verified_at = now
        user.kvkk_consent_at = now
        user.kvkk_policy_version = current_policy_version()

        # Generate tokens
        raw_token, token_hashed, family_id = create_refresh_token()
        settings = get_settings()
        expires_at = datetime.now(UTC) + timedelta(days=settings.refresh_token_ttl_days)
        await self.repo.create_refresh_token(user.id, token_hashed, family_id, expires_at)

        access_token = create_access_token(str(user.id))
        await log_event(self.session, "register_success", user_id=user.id)
        await self.session.commit()
        if user.email_verified_at is None:
            await self._send_verification_code(user.id, user.email)

        return AuthTokensResponse(
            user_id=user.id,
            access_token=access_token,
            refresh_token=raw_token,
            user=UserPublic(id=user.id, email=user.email, name=user.name, username=user.username),
        )

    async def _generate_username(self, seed: str) -> str:
        import re

        base = re.sub(r"[^a-z0-9_]", "", seed.lower().replace(" ", "_"))[:26] or "user"
        candidate = base
        suffix = 1
        while (
            candidate in RESERVED_USERNAMES
            or await self.repo.get_user_by_username(candidate) is not None
        ):
            suffix += 1
            candidate = f"{base}{suffix}"[:30]
        return candidate

    async def login(
        self,
        email: str,
        password: str,
        throttle: LoginThrottle | None = None,
        ip: str = "127.0.0.1",
    ) -> TokenResponse:
        # `email` doubles as a generic identifier here — it may be an actual
        # email address or a @username, since the login form accepts either.
        identifier = email

        # Check throttle if provided
        if throttle:
            allowed, retry_after = await throttle.check(identifier, ip)
            if not allowed:
                raise AuthError(
                    f"Too many failed attempts. Try again in {retry_after} seconds",
                    429,
                )

        # Get user — by email if it looks like one, otherwise by username.
        if "@" in identifier:
            user = await self.repo.get_user_by_email(identifier)
        else:
            user = await self.repo.get_user_by_username(identifier)
        if not user:
            await log_event(self.session, "login_failed", metadata={"email": identifier})
            # Commit before raising: the request's session is rolled back on
            # error, which silently discarded every failed-login audit entry.
            await self.session.commit()
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
                await throttle.record_failure(identifier, ip)
            await log_event(self.session, "login_failed", metadata={"email": identifier})
            # Commit before raising: the request's session is rolled back on
            # error, which silently discarded every failed-login audit entry.
            await self.session.commit()
            raise AuthError("Email or password is incorrect", 401)

        # Generate tokens
        raw_token, token_hashed, family_id = create_refresh_token()
        settings = get_settings()
        expires_at = datetime.now(UTC) + timedelta(days=settings.refresh_token_ttl_days)
        await self.repo.create_refresh_token(user.id, token_hashed, family_id, expires_at)

        # Update last active
        await self.repo.update_last_active(user.id)

        access_token = create_access_token(str(user.id))
        await log_event(self.session, "login_success", user_id=user.id)
        await self.session.commit()

        return TokenResponse(
            access_token=access_token,
            refresh_token=raw_token,
            user=UserPublic(id=user.id, email=user.email, name=user.name, username=user.username),
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
        await self.repo.create_refresh_token(rt.user_id, new_hashed, rt.family_id, new_expires)

        access_token = create_access_token(str(rt.user_id))
        await log_event(self.session, "token_refreshed", user_id=rt.user_id)
        await self.session.commit()

        user = await self.repo.get_user_by_id(rt.user_id)
        if user is None or user.status != UserStatus.active:
            raise AuthError("Account is not active", 401)

        return TokenResponse(
            access_token=access_token,
            refresh_token=new_raw,
            user=UserPublic(id=user.id, email=user.email, name=user.name, username=user.username),
        )

    async def logout(self, user_id: uuid.UUID, refresh_token: str | None = None) -> None:
        if refresh_token:
            token_hashed = hash_token(refresh_token)
            rt = await self.repo.get_refresh_token(token_hashed)
            if rt and rt.user_id == user_id:
                await self.repo.revoke_family(rt.family_id)
        await log_event(self.session, "logout", user_id=user_id)
        await self.session.commit()

    # -- Sign in with Google ------------------------------------------------

    async def login_with_google(self, id_token: str, kvkk_consent: bool) -> GoogleLoginResponse:
        try:
            identity = await verify_google_id_token(id_token)
        except GoogleAuthError as e:
            code = str(e)
            raise AuthError(
                code, 503 if code in ("GOOGLE_NOT_CONFIGURED", "GOOGLE_UNAVAILABLE") else 401
            ) from e

        is_new = False
        user = (
            await self.session.execute(select(User).where(User.google_sub == identity.sub))
        ).scalar_one_or_none()
        if user is None:
            existing = await self.repo.get_user_by_email(identity.email)
            if existing is not None:
                # Only link to an existing account when Google vouches for the
                # mailbox — otherwise anyone could claim someone's account.
                if not identity.email_verified:
                    raise AuthError("GOOGLE_EMAIL_NOT_VERIFIED", 409)
                if existing.google_sub and existing.google_sub != identity.sub:
                    raise AuthError("GOOGLE_ACCOUNT_MISMATCH", 409)
                existing.google_sub = identity.sub
                user = existing
            else:
                if not kvkk_consent:
                    raise AuthError("KVKK_CONSENT_REQUIRED", 422)
                name = (identity.name or identity.email.split("@")[0])[:100]
                username = await self._generate_username(name)
                user = User(
                    email=identity.email, name=name, username=username, google_sub=identity.sub
                )
                now = datetime.now(UTC)
                if identity.email_verified:
                    user.email_verified_at = now
                user.kvkk_consent_at = now
                user.kvkk_policy_version = current_policy_version()
                self.session.add(user)
                await self.session.flush()
                is_new = True

        if user.status != UserStatus.active:
            raise AuthError("Account is not active", 401)
        if identity.email_verified and user.email_verified_at is None:
            user.email_verified_at = datetime.now(UTC)

        raw_token, token_hashed, family_id = create_refresh_token()
        settings = get_settings()
        await self.repo.create_refresh_token(
            user.id,
            token_hashed,
            family_id,
            datetime.now(UTC) + timedelta(days=settings.refresh_token_ttl_days),
        )
        await self.repo.update_last_active(user.id)
        await log_event(
            self.session,
            "register_success" if is_new else "login_success",
            user_id=user.id,
            metadata={"method": "google"},
        )
        await self.session.commit()
        return GoogleLoginResponse(
            access_token=create_access_token(str(user.id)),
            refresh_token=raw_token,
            user=UserPublic(id=user.id, email=user.email, name=user.name, username=user.username),
            is_new_user=is_new,
        )

    # -- One-time email codes ---------------------------------------------

    async def _latest_code(self, user_id: uuid.UUID, purpose: EmailCodePurpose) -> EmailCode | None:
        result = await self.session.execute(
            select(EmailCode)
            .where(EmailCode.user_id == user_id, EmailCode.purpose == purpose.value)
            .order_by(EmailCode.created_at.desc())
            .limit(1)
        )
        return result.scalar_one_or_none()

    async def _issue_code(self, user_id: uuid.UUID, purpose: EmailCodePurpose) -> str:
        """Create a fresh code; any earlier unused code of this purpose dies."""
        now = datetime.now(UTC)
        await self.session.execute(
            update(EmailCode)
            .where(
                EmailCode.user_id == user_id,
                EmailCode.purpose == purpose.value,
                EmailCode.used_at.is_(None),
            )
            .values(used_at=now)
        )
        code = f"{secrets.randbelow(1_000_000):06d}"
        self.session.add(
            EmailCode(
                user_id=user_id,
                purpose=purpose.value,
                code_hash=_code_hash(user_id, code),
                expires_at=now + timedelta(minutes=CODE_TTL_MINUTES),
            )
        )
        await self.session.flush()
        return code

    async def _consume_code(self, user_id: uuid.UUID, purpose: EmailCodePurpose, code: str) -> bool:
        entry = await self._latest_code(user_id, purpose)
        now = datetime.now(UTC)
        if (
            entry is None
            or entry.used_at is not None
            or entry.expires_at < now
            or entry.attempts >= MAX_CODE_ATTEMPTS
        ):
            return False
        if not hmac.compare_digest(entry.code_hash, _code_hash(user_id, code.strip())):
            entry.attempts += 1
            await self.session.commit()
            return False
        entry.used_at = now
        return True

    async def _cooldown_active(self, user_id: uuid.UUID, purpose: EmailCodePurpose) -> bool:
        last = await self._latest_code(user_id, purpose)
        return (
            last is not None
            and (datetime.now(UTC) - last.created_at).total_seconds() < CODE_RESEND_COOLDOWN_SECONDS
        )

    async def _send_verification_code(self, user_id: uuid.UUID, email: str) -> None:
        code = await self._issue_code(user_id, EmailCodePurpose.verify_email)
        await self.session.commit()
        text, html = code_email(
            "E-posta adresini doğrula",
            "MeetBook hesabını doğrulamak için bu kodu uygulamaya gir:",
            code,
            CODE_TTL_MINUTES,
        )
        await send_mail(email, f"MeetBook doğrulama kodun: {code}", text, html)

    # -- Email verification -------------------------------------------------

    async def resend_verification(self, user_id: uuid.UUID) -> MessageResponse:
        user = await self.repo.get_user_by_id(user_id)
        if user is None:
            raise AuthError("Not found", 404)
        if user.email_verified_at is not None:
            return MessageResponse(message="Email already verified")
        if await self._cooldown_active(user_id, EmailCodePurpose.verify_email):
            raise AuthError("Please wait before requesting a new code", 429)
        await self._send_verification_code(user.id, user.email)
        return MessageResponse(message="Verification code sent")

    async def verify_email(self, user_id: uuid.UUID, code: str) -> MessageResponse:
        user = await self.repo.get_user_by_id(user_id)
        if user is None:
            raise AuthError("Not found", 404)
        if user.email_verified_at is not None:
            return MessageResponse(message="Email already verified")
        if not await self._consume_code(user_id, EmailCodePurpose.verify_email, code):
            raise AuthError("INVALID_CODE", 400)
        user.email_verified_at = datetime.now(UTC)
        await log_event(self.session, "email_verified", user_id=user_id)
        # Signed up with a university address: the same code proves it.
        if is_edu_email(user.email) and user.edu_verified_at is None:
            if not await self._edu_email_taken(user.email.strip().lower(), user.id):
                await self._mark_edu_verified(user, user.email.strip().lower())
        await self.session.commit()
        return MessageResponse(message="Email verified")

    # -- University (.edu.tr) verification ----------------------------------
    # One verified student address per account is what makes the starter
    # credit and the allowed debt safe to hand out: no throwaway accounts.

    async def _edu_email_taken(self, edu_email: str, user_id: uuid.UUID) -> bool:
        result = await self.session.execute(
            select(User.id).where(User.edu_email == edu_email, User.id != user_id).limit(1)
        )
        return result.scalar_one_or_none() is not None

    async def _mark_edu_verified(self, user: User, edu_email: str) -> None:
        from app.modules.credits.service import CreditService

        user.edu_email = edu_email
        user.edu_verified_at = datetime.now(UTC)
        user.pending_edu_email = None
        await self.session.flush()
        await CreditService(self.session).grant_starter(user.id)
        await log_event(self.session, "edu_verified", user_id=user.id)

    async def request_edu_verification(self, user_id: uuid.UUID, edu_email: str) -> MessageResponse:
        email = edu_email.strip().lower()
        if not is_edu_email(email):
            raise AuthError("NOT_EDU_EMAIL", 422)
        user = await self.repo.get_user_by_id(user_id)
        if user is None:
            raise AuthError("Not found", 404)
        if user.edu_verified_at is not None:
            raise AuthError("EDU_ALREADY_VERIFIED", 409)
        if await self._edu_email_taken(email, user_id):
            raise AuthError("EDU_EMAIL_TAKEN", 409)
        if await self._cooldown_active(user_id, EmailCodePurpose.verify_edu):
            raise AuthError("Please wait before requesting a new code", 429)
        settings = get_settings()
        if not settings.mail_enabled and not settings.is_dev:
            # Never auto-verify a student address: the code must reach that inbox.
            raise AuthError("MAIL_NOT_CONFIGURED", 503)

        user.pending_edu_email = email
        code = await self._issue_code(user_id, EmailCodePurpose.verify_edu)
        await self.session.commit()
        text, html = code_email(
            "Üniversite e-postanı doğrula",
            "Öğrenci hesabını doğrulamak için bu kodu MeetBook'a gir:",
            code,
            CODE_TTL_MINUTES,
        )
        await send_mail(email, f"MeetBook öğrenci doğrulama kodun: {code}", text, html)
        return MessageResponse(message="Verification code sent")

    async def verify_edu(self, user_id: uuid.UUID, code: str) -> MessageResponse:
        user = await self.repo.get_user_by_id(user_id)
        if user is None:
            raise AuthError("Not found", 404)
        if user.edu_verified_at is not None:
            return MessageResponse(message="University email already verified")
        if user.pending_edu_email is None:
            raise AuthError("NO_PENDING_EDU_EMAIL", 400)
        if not await self._consume_code(user_id, EmailCodePurpose.verify_edu, code):
            raise AuthError("INVALID_CODE", 400)
        if await self._edu_email_taken(user.pending_edu_email, user_id):
            raise AuthError("EDU_EMAIL_TAKEN", 409)
        try:
            await self._mark_edu_verified(user, user.pending_edu_email)
            await self.session.commit()
        except IntegrityError as e:
            # Lost a race with another account verifying the same address.
            await self.session.rollback()
            raise AuthError("EDU_EMAIL_TAKEN", 409) from e
        return MessageResponse(message="University email verified")

    # -- Password reset (6-digit code by email) -----------------------------

    async def request_password_reset(self, email: str) -> MessageResponse:
        user = await self.repo.get_user_by_email(email)
        if (
            user
            and user.status == UserStatus.active
            and not await self._cooldown_active(user.id, EmailCodePurpose.password_reset)
        ):
            code = await self._issue_code(user.id, EmailCodePurpose.password_reset)
            await log_event(self.session, "password_reset_requested", user_id=user.id)
            await self.session.commit()
            text, html = code_email(
                "Şifre sıfırlama",
                "MeetBook şifreni sıfırlamak için bu kodu uygulamaya gir:",
                code,
                CODE_TTL_MINUTES,
            )
            await send_mail(user.email, f"MeetBook şifre sıfırlama kodun: {code}", text, html)

        # Always the same answer (don't reveal whether the email exists)
        return MessageResponse(message="If the email exists, a reset code has been sent")

    async def confirm_password_reset(
        self,
        new_password: str,
        token: str | None = None,
        email: str | None = None,
        code: str | None = None,
    ) -> MessageResponse:
        if email and code:
            user = await self.repo.get_user_by_email(email)
            if user is None or not await self._consume_code(
                user.id, EmailCodePurpose.password_reset, code
            ):
                raise AuthError("Invalid or expired reset code", 400)
        elif token:
            # Legacy opaque-token flow (kept for API compatibility).
            prt = await self.repo.get_password_reset_token(hash_token(token))
            if not prt or prt.used_at is not None:
                raise AuthError("Invalid or expired reset token", 400)
            if prt.expires_at < datetime.now(UTC):
                raise AuthError("Reset token expired", 400)
            user = await self.repo.get_user_by_id(prt.user_id)
            if not user:
                raise AuthError("Invalid reset token", 400)
            await self.repo.mark_password_reset_used(prt.id)
        else:
            raise AuthError("email+code or token is required", 422)

        credential = await self.repo.get_credential_by_user_id(user.id)
        if credential:
            credential.password_hash = hash_password(new_password)
        else:
            # Google-only account setting its first password.
            self.session.add(
                UserCredential(user_id=user.id, password_hash=hash_password(new_password))
            )
        # A working reset code proves mailbox ownership.
        if user.email_verified_at is None:
            user.email_verified_at = datetime.now(UTC)
        # Revoke all refresh tokens (log out every device)
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
            username=user.username,
            email_verified=user.email_verified_at is not None or user.phone_verified_at is not None,
            has_password=await self.repo.get_credential_by_user_id(user.id) is not None,
            avatar_url=user.avatar_url,
            trusted_contact_name=user.trusted_contact_name,
            trusted_contact_phone=user.trusted_contact_phone,
            geofence_radius_km=user.geofence_radius_km,
            notification_settings=user.notification_settings or {},
            auto_accept_rules=user.auto_accept_rules or [],
            edu_verified=user.edu_verified_at is not None,
            edu_email=user.edu_email,
            pending_edu_email=user.pending_edu_email,
            credit_balance=user.credit_balance,
            is_teacher=user.teacher_verified_at is not None,
            teacher_institution=user.teacher_institution,
        )

    async def is_username_available(self, username: str) -> bool:
        if username.lower() in RESERVED_USERNAMES:
            return False
        return await self.repo.get_user_by_username(username) is None

    async def search_users(self, current_user_id: uuid.UUID, query: str) -> list[UserSearchResult]:
        trimmed = query.strip()
        if len(trimmed) < 2:
            return []
        users = await self.repo.search_users(trimmed, current_user_id)
        return [
            UserSearchResult(id=u.id, name=u.name, username=u.username, avatar_url=u.avatar_url)
            for u in users
        ]

    async def get_user_profile(self, user_id: uuid.UUID) -> UserPublicProfile:
        user = await self.repo.get_user_by_id(user_id)
        if user is None:
            raise AuthError("Not found", 404)
        from app.modules.auth.trust import compute_trust

        trust = compute_trust(
            rating_average=float(user.rating_average or 0),
            loans_borrowed_count=user.loans_borrowed_count,
            loans_returned_on_time=user.loans_returned_on_time,
            loans_returned_late=user.loans_returned_late,
            trust_score_override=(
                float(user.trust_score_override) if user.trust_score_override is not None else None
            ),
        )
        return UserPublicProfile(
            id=user.id,
            name=user.name,
            username=user.username,
            avatar_url=user.avatar_url,
            completed_exchanges=user.completed_exchanges,
            rating_average=float(user.rating_average),
            rating_count=user.rating_count,
            loans_borrowed_count=user.loans_borrowed_count,
            trust_score=trust.score,
            trust_badge=trust.badge,
            trust_label=trust.label,
        )

    async def update_me(self, user_id: uuid.UUID, body: UpdateMeRequest) -> MeResponse:
        user = await self.repo.get_user_by_id(user_id)
        if user is None:
            raise AuthError("Not found", 404)
        # Partial update: only touch fields the caller actually sent. A PATCH that
        # omits trusted_contact_* (e.g. the radius-only updateGeofenceRadius call)
        # must NOT null out the user's saved trusted contact.
        sent = body.model_fields_set
        if "trusted_contact_name" in sent:
            user.trusted_contact_name = body.trusted_contact_name
        if "trusted_contact_phone" in sent:
            user.trusted_contact_phone = body.trusted_contact_phone
        if "geofence_radius_km" in sent and body.geofence_radius_km is not None:
            user.geofence_radius_km = body.geofence_radius_km
        if "name" in sent and body.name is not None:
            user.name = body.name
        if "username" in sent and body.username is not None:
            normalized = body.username.lower()
            if normalized != user.username:
                if normalized in RESERVED_USERNAMES:
                    raise AuthError("Username is reserved", 409)
                existing = await self.repo.get_user_by_username(normalized)
                if existing is not None:
                    raise AuthError("Username already taken", 409)
                user.username = normalized
        if "notification_settings" in sent:
            user.notification_settings = body.notification_settings
        if "auto_accept_rules" in sent:
            user.auto_accept_rules = body.auto_accept_rules
        await self.session.commit()
        return await self.get_me(user_id)

    async def delete_account(self, user_id: uuid.UUID, password: str) -> None:
        user = await self.repo.get_user_by_id(user_id)
        if user is None:
            raise AuthError("Not found", 404)

        # Verify password
        credential = await self.repo.get_credential_by_user_id(user_id)
        if credential and not verify_password(password, credential.password_hash):
            raise AuthError("Password is incorrect", 401)

        # Anonymize PII
        user.email = f"deleted-{user.id}@anon"
        user.name = "Silinmiş Hesap"
        user.phone = None
        user.trusted_contact_name = None
        user.trusted_contact_phone = None
        user.status = UserStatus.deleted
        user.updated_at = datetime.now(UTC)

        # Revoke all tokens
        await self.repo.revoke_all_user_tokens(user.id)

        await log_event(self.session, "account_deleted", user_id=user.id)
        await self.session.commit()

    async def upload_avatar(self, user_id: uuid.UUID, file_bytes: bytes, content_type: str) -> str:
        del content_type  # the client's label is not trusted — see below
        user = await self.repo.get_user_by_id(user_id)
        if user is None:
            raise AuthError("Not found", 404)

        if len(file_bytes) > MAX_AVATAR_BYTES:
            raise AuthError("FILE_TOO_LARGE", 400)

        # Real type from the bytes, image-bomb limits, GPS/EXIF stripped —
        # animated GIF avatars are allowed (see app/core/image_safety.py).
        from app.core.image_safety import AVATAR_LIMITS, UnsafeImageError, sanitize_image

        try:
            image = sanitize_image(file_bytes, AVATAR_LIMITS)
        except UnsafeImageError as exc:
            raise AuthError(exc.code, 400) from None
        detected, file_bytes = image.content_type, image.data

        # Upload to S3 with user_id as "folder"
        from app.core.s3 import _get_extension, _is_s3_configured, _upload_local, _upload_s3

        filename = f"avatar_{user_id}.{_get_extension(detected)}"
        if _is_s3_configured():
            url = await _upload_s3(user_id, filename, file_bytes, detected)
        else:
            url = await _upload_local(user_id, filename, file_bytes)
        # Same object key on every change: version the URL so apps and caches
        # don't keep showing the previous photo/GIF.
        url = f"{url}?v={int(datetime.now(UTC).timestamp())}"

        user.avatar_url = url
        user.updated_at = datetime.now(UTC)
        await self.session.commit()
        return url

    # ------------------------------------------------------------------
    # B12: Active sessions / devices
    # ------------------------------------------------------------------

    async def list_sessions(self, user_id: uuid.UUID) -> list[RefreshToken]:
        result = await self.session.execute(
            select(RefreshToken)
            .where(RefreshToken.user_id == user_id, RefreshToken.revoked_at.is_(None))
            .order_by(RefreshToken.created_at.desc())
        )
        return list(result.scalars().all())

    async def revoke_session(self, user_id: uuid.UUID, token_id: uuid.UUID) -> None:
        await self.session.execute(
            update(RefreshToken)
            .where(RefreshToken.id == token_id, RefreshToken.user_id == user_id)
            .values(revoked_at=datetime.now(UTC))
        )
        await self.session.commit()

    # ------------------------------------------------------------------
    # B25: Vouching system
    # ------------------------------------------------------------------

    async def create_vouch(
        self, voucher_id: uuid.UUID, vouchee_id: uuid.UUID, note: str | None
    ) -> VouchView:
        if voucher_id == vouchee_id:
            raise AuthError("Kendiniz için kefil olamazsınız", 422)

        existing = await self.session.execute(
            select(Vouch).where(Vouch.voucher_id == voucher_id, Vouch.vouchee_id == vouchee_id)
        )
        if existing.scalar_one_or_none() is not None:
            raise AuthError("Bu kullanıcı için zaten kefil oldunuz", 409)

        vouch = Vouch(voucher_id=voucher_id, vouchee_id=vouchee_id, note=note)
        self.session.add(vouch)
        await log_event(
            self.session,
            "vouch_created",
            user_id=voucher_id,
            metadata={"vouchee_id": str(vouchee_id)},
        )
        await self.session.commit()
        return VouchView(
            voucher_id=voucher_id,
            vouchee_id=vouchee_id,
            note=note,
            created_at=vouch.created_at,
        )

    async def list_vouches(self, user_id: uuid.UUID) -> VouchListResponse:
        result = await self.session.execute(
            select(Vouch).where(Vouch.vouchee_id == user_id).order_by(Vouch.created_at.desc())
        )
        vouches = result.scalars().all()
        return VouchListResponse(
            items=[
                VouchView(
                    voucher_id=v.voucher_id,
                    vouchee_id=v.vouchee_id,
                    note=v.note,
                    created_at=v.created_at,
                )
                for v in vouches
            ]
        )

    # ------------------------------------------------------------------
    # B27: Reading history export
    # ------------------------------------------------------------------

    async def export_reading_history(self, user_id: uuid.UUID) -> dict[str, Any]:
        from app.modules.books.models import Book
        from app.modules.exchanges.models import ExchangeRequest
        from app.modules.ratings.models import Rating

        user = await self.repo.get_user_by_id(user_id)
        if user is None:
            raise AuthError("Not found", 404)

        books_result = await self.session.execute(
            select(Book)
            .where(Book.owner_id == user_id, Book.deleted_at.is_(None))
            .order_by(Book.created_at.desc())
        )
        books = books_result.scalars().all()

        exchanges_result = await self.session.execute(
            select(ExchangeRequest)
            .where(
                (ExchangeRequest.requested_by == user_id)
                | (ExchangeRequest.requested_to == user_id)
            )
            .order_by(ExchangeRequest.created_at.desc())
        )
        exchanges = exchanges_result.scalars().all()

        ratings_result = await self.session.execute(
            select(Rating)
            .where((Rating.rated_by == user_id) | (Rating.rated_user == user_id))
            .order_by(Rating.created_at.desc())
        )
        ratings = ratings_result.scalars().all()

        return {
            "user": {
                "id": str(user.id),
                "name": user.name,
                "email": user.email,
                "completed_exchanges": user.completed_exchanges,
                "rating_average": float(user.rating_average or 0),
                "rating_count": user.rating_count,
            },
            "books": [
                {
                    "id": str(b.id),
                    "title": b.title,
                    "author": b.author,
                    "category": b.category.value if b.category else None,
                    "language": b.language,
                    "condition": b.condition.value if b.condition else None,
                    "is_available": b.is_available,
                    "created_at": b.created_at.isoformat() if b.created_at else None,
                }
                for b in books
            ],
            "exchanges": [
                {
                    "id": str(e.id),
                    "book_id": str(e.book_id),
                    "requested_by": str(e.requested_by),
                    "requested_to": str(e.requested_to),
                    "status": e.status.value if e.status else None,
                    "mode": e.mode.value if e.mode else None,
                    "created_at": e.created_at.isoformat() if e.created_at else None,
                }
                for e in exchanges
            ],
            "ratings": [
                {
                    "id": str(r.id),
                    "exchange_request_id": str(r.exchange_request_id),
                    "score": r.score,
                    "comment": r.comment,
                    "created_at": r.created_at.isoformat() if r.created_at else None,
                }
                for r in ratings
            ],
            "exported_at": datetime.now(UTC).isoformat(),
        }
