"""Database queries for auth tables."""

import uuid
from datetime import UTC, datetime

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.auth.models import (
    AuditLog,
    PasswordResetToken,
    RefreshToken,
    User,
    UserCredential,
    UserStatus,
)


class AuthRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    # ------------------------------------------------------------------
    # Credentials
    # ------------------------------------------------------------------

    async def get_credential_by_user_id(self, user_id: uuid.UUID) -> UserCredential | None:
        result = await self.session.execute(
            select(UserCredential).where(UserCredential.user_id == user_id)
        )
        return result.scalar_one_or_none()

    # ------------------------------------------------------------------
    # Users
    # ------------------------------------------------------------------

    async def get_user_by_email(self, email: str) -> User | None:
        # Case-insensitive: "Can@x.com" and "can@x.com" are the same mailbox.
        # .first() (not scalar_one_or_none) tolerates legacy rows that differ
        # only by case, oldest account wins.
        result = await self.session.execute(
            select(User)
            .where(func.lower(User.email) == email.strip().lower())
            .order_by(User.created_at)
        )
        return result.scalars().first()

    async def get_user_by_id(self, user_id: uuid.UUID) -> User | None:
        result = await self.session.execute(select(User).where(User.id == user_id))
        return result.scalar_one_or_none()

    async def get_user_by_username(self, username: str) -> User | None:
        result = await self.session.execute(select(User).where(User.username == username.lower()))
        return result.scalar_one_or_none()

    async def search_users(
        self, query: str, exclude_user_id: uuid.UUID, limit: int = 20
    ) -> list[User]:
        """Find active users by name or @username, excluding the caller and
        anyone blocked in either direction (mirrors the visibility rule
        chat/exchanges use)."""
        from app.modules.exchanges.models import Block

        blocked_by_me = select(Block.blocked_id).where(Block.blocker_id == exclude_user_id)
        blocked_me = select(Block.blocker_id).where(Block.blocked_id == exclude_user_id)
        needle = query.lstrip("@")

        result = await self.session.execute(
            select(User)
            .where(
                (User.name.ilike(f"%{needle}%") | User.username.ilike(f"%{needle}%")),
                User.id != exclude_user_id,
                User.status == UserStatus.active,
                User.id.notin_(blocked_by_me),
                User.id.notin_(blocked_me),
            )
            .order_by(User.name)
            .limit(limit)
        )
        return list(result.scalars().all())

    async def create_user(
        self, email: str, name: str, username: str, password_hash: str
    ) -> tuple[User, UserCredential]:
        user = User(email=email.strip().lower(), name=name, username=username.lower())
        self.session.add(user)
        await self.session.flush()  # get user.id

        credential = UserCredential(user_id=user.id, password_hash=password_hash)
        self.session.add(credential)

        return user, credential

    async def update_last_active(self, user_id: uuid.UUID) -> None:
        await self.session.execute(
            update(User).where(User.id == user_id).values(last_active_at=datetime.now(UTC))
        )

    # ------------------------------------------------------------------
    # Refresh tokens
    # ------------------------------------------------------------------

    async def create_refresh_token(
        self,
        user_id: uuid.UUID,
        token_hash: str,
        family_id: uuid.UUID,
        expires_at: datetime,
        device_info: dict[str, str] | None = None,
    ) -> RefreshToken:
        rt = RefreshToken(
            user_id=user_id,
            token_hash=token_hash,
            family_id=family_id,
            device_info=device_info,
            expires_at=expires_at,
        )
        self.session.add(rt)
        return rt

    async def get_refresh_token(self, token_hash: str) -> RefreshToken | None:
        result = await self.session.execute(
            select(RefreshToken).where(RefreshToken.token_hash == token_hash)
        )
        return result.scalar_one_or_none()

    async def revoke_token(self, token_hash: str) -> None:
        await self.session.execute(
            update(RefreshToken)
            .where(RefreshToken.token_hash == token_hash)
            .values(revoked_at=datetime.now(UTC))
        )

    async def revoke_family(self, family_id: uuid.UUID) -> None:
        await self.session.execute(
            update(RefreshToken)
            .where(RefreshToken.family_id == family_id)
            .where(RefreshToken.revoked_at.is_(None))
            .values(revoked_at=datetime.now(UTC))
        )

    async def revoke_all_user_tokens(self, user_id: uuid.UUID) -> None:
        await self.session.execute(
            update(RefreshToken)
            .where(RefreshToken.user_id == user_id)
            .where(RefreshToken.revoked_at.is_(None))
            .values(revoked_at=datetime.now(UTC))
        )

    # ------------------------------------------------------------------
    # Password reset tokens
    # ------------------------------------------------------------------

    async def create_password_reset_token(
        self,
        user_id: uuid.UUID,
        token_hash: str,
        expires_at: datetime,
    ) -> PasswordResetToken:
        prt = PasswordResetToken(
            user_id=user_id,
            token_hash=token_hash,
            expires_at=expires_at,
        )
        self.session.add(prt)
        return prt

    async def get_password_reset_token(self, token_hash: str) -> PasswordResetToken | None:
        result = await self.session.execute(
            select(PasswordResetToken).where(PasswordResetToken.token_hash == token_hash)
        )
        return result.scalar_one_or_none()

    async def mark_password_reset_used(self, token_id: uuid.UUID) -> None:
        await self.session.execute(
            update(PasswordResetToken)
            .where(PasswordResetToken.id == token_id)
            .values(used_at=datetime.now(UTC))
        )

    # ------------------------------------------------------------------
    # Audit log
    # ------------------------------------------------------------------

    async def log_event(
        self,
        event_type: str,
        user_id: uuid.UUID | None = None,
        ip_address: str | None = None,
        user_agent: str | None = None,
        metadata: dict[str, str] | None = None,
    ) -> None:
        entry = AuditLog(
            event_type=event_type,
            user_id=user_id,
            ip_address=ip_address,
            user_agent=user_agent,
            metadata_=metadata,
        )
        self.session.add(entry)
