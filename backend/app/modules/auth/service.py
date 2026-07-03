"""Auth business logic — register, login, refresh, logout, password reset."""

import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import select, update
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
from app.core.s3 import upload_photo as s3_upload_photo
from app.core.throttle import LoginThrottle
from app.modules.auth.models import RefreshToken, UserStatus, Vouch
from app.modules.auth.repository import AuthRepository
from app.modules.auth.schemas import (
    AuthTokensResponse,
    MeResponse,
    MessageResponse,
    RESERVED_USERNAMES,
    SessionListResponse,
    SessionView,
    TokenResponse,
    UpdateMeRequest,
    UserPublic,
    UserPublicProfile,
    UserSearchResult,
    VouchListResponse,
    VouchView,
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
        self,
        email: str,
        password: str,
        name: str,
        kvkk_consent: bool,
        username: str | None = None,
    ) -> AuthTokensResponse:
        if kvkk_consent is not True:
            raise AuthError("KVKK consent is required", 422)

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
            user=UserPublic(id=user.id, email=user.email, name=user.name, username=user.username),
        )

    async def _generate_username(self, seed: str) -> str:
        import re

        base = re.sub(r"[^a-z0-9_]", "", seed.lower().replace(" ", "_"))[:26] or "user"
        candidate = base
        suffix = 1
        while candidate in RESERVED_USERNAMES or await self.repo.get_user_by_username(candidate) is not None:
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
        await self.repo.create_refresh_token(
            rt.user_id, new_hashed, rt.family_id, new_expires
        )

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
            # TODO: In production — send email with raw_token via mail provider

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
            username=user.username,
            avatar_url=user.avatar_url,
            trusted_contact_name=user.trusted_contact_name,
            trusted_contact_phone=user.trusted_contact_phone,
            geofence_radius_km=user.geofence_radius_km,
            notification_settings=user.notification_settings or {},
            auto_accept_rules=user.auto_accept_rules or [],
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
                float(user.trust_score_override)
                if user.trust_score_override is not None
                else None
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

    async def upload_avatar(
        self, user_id: uuid.UUID, file_bytes: bytes, content_type: str
    ) -> str:
        user = await self.repo.get_user_by_id(user_id)
        if user is None:
            raise AuthError("Not found", 404)

        allowed_types = {"image/jpeg", "image/png", "image/webp"}
        if content_type not in allowed_types:
            raise AuthError("INVALID_IMAGE_FORMAT", 400)

        if len(file_bytes) > 5 * 1024 * 1024:
            raise AuthError("FILE_TOO_LARGE", 400)

        # Upload to S3 with user_id as "folder"
        from app.core.s3 import _upload_s3, _is_s3_configured, _upload_local

        if _is_s3_configured():
            url = await _upload_s3(user_id, f"avatar_{user_id}", file_bytes, content_type)
        else:
            url = await _upload_local(user_id, f"avatar_{user_id}", file_bytes)

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
            select(Vouch).where(
                Vouch.voucher_id == voucher_id, Vouch.vouchee_id == vouchee_id
            )
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
            select(Vouch)
            .where(Vouch.vouchee_id == user_id)
            .order_by(Vouch.created_at.desc())
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

    async def export_reading_history(self, user_id: uuid.UUID) -> dict:
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
            .where(
                (Rating.rated_by == user_id) | (Rating.rated_user == user_id)
            )
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
