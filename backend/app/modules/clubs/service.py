"""Book club business logic.

Rules
- A club has at most MAX_CLUB_MEMBERS people (owner + invited/active).
- Members are real users who must ACCEPT an invite before they see the chat
  or take part — nobody is dropped into a group without consent.
- Each active member contributes one of their own (non-deleted) books.
- Only the owner shuffles; the shuffle is a server-side derangement (nobody
  receives their own book) over ACTIVE members, and needs ≥2 of them, all
  with a book. Membership changes after a shuffle invalidate it.
- Only active members can read/post messages. Messages are delivered live
  over the chat WebSocket as {"type": "club_message", ...}.
"""

import json
import logging
import random
import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.auth.models import User, UserStatus
from app.modules.books.models import Book, BookPhoto
from app.modules.clubs.models import Club, ClubMember, ClubMessage
from app.modules.clubs.schemas import (
    MAX_CLUB_MEMBERS,
    ClubBookView,
    ClubCreateRequest,
    ClubDetail,
    ClubListResponse,
    ClubMemberView,
    ClubMessageListResponse,
    ClubMessageView,
    ClubSummary,
)
from app.modules.exchanges.models import Block

logger = logging.getLogger(__name__)

ACTIVE = "active"
INVITED = "invited"
OPEN_STATUSES = (ACTIVE, INVITED)


class ClubError(Exception):
    def __init__(self, code: str, status_code: int = 400) -> None:
        self.code = code
        self.status_code = status_code


def derangement(ids: list[uuid.UUID]) -> dict[uuid.UUID, uuid.UUID]:
    """receiver -> giver, with nobody receiving their own book (n ≥ 2)."""
    if len(ids) < 2:
        raise ValueError("need at least two members")
    rng = random.SystemRandom()
    while True:  # expected ~e tries; n ≤ 5
        givers = ids[:]
        rng.shuffle(givers)
        if all(r != g for r, g in zip(ids, givers, strict=True)):
            return dict(zip(ids, givers, strict=True))


class ClubService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    # ── helpers ─────────────────────────────────────────────────────────

    async def _get_club(self, club_id: uuid.UUID) -> Club:
        club = await self.session.get(Club, club_id)
        if club is None:
            raise ClubError("NOT_FOUND", 404)
        return club

    async def _members(self, club_id: uuid.UUID) -> list[ClubMember]:
        rows = await self.session.execute(
            select(ClubMember).where(ClubMember.club_id == club_id).order_by(ClubMember.created_at)
        )
        return list(rows.scalars().all())

    async def _membership(self, club_id: uuid.UUID, user_id: uuid.UUID) -> ClubMember | None:
        rows = await self.session.execute(
            select(ClubMember).where(ClubMember.club_id == club_id, ClubMember.user_id == user_id)
        )
        return rows.scalar_one_or_none()

    async def _require_member(
        self, club_id: uuid.UUID, user_id: uuid.UUID, statuses: tuple[str, ...] = (ACTIVE,)
    ) -> ClubMember:
        m = await self._membership(club_id, user_id)
        if m is None or m.status not in statuses:
            # Existence-hiding for outsiders.
            raise ClubError("NOT_FOUND", 404)
        return m

    async def _is_blocked(self, a: uuid.UUID, b: uuid.UUID) -> bool:
        n = await self.session.scalar(
            select(func.count())
            .select_from(Block)
            .where(
                or_(
                    and_(Block.blocker_id == a, Block.blocked_id == b),
                    and_(Block.blocker_id == b, Block.blocked_id == a),
                )
            )
        )
        return bool(n)

    async def _users(self, ids: set[uuid.UUID]) -> dict[uuid.UUID, User]:
        if not ids:
            return {}
        rows = await self.session.execute(select(User).where(User.id.in_(ids)))
        return {u.id: u for u in rows.scalars().all()}

    async def _check_invitee(self, club: Club, inviter_id: uuid.UUID, user_id: uuid.UUID) -> None:
        if user_id == inviter_id:
            raise ClubError("CANNOT_INVITE_SELF", 400)
        user = await self.session.get(User, user_id)
        if user is None or user.status != UserStatus.active:
            raise ClubError("USER_NOT_FOUND", 404)
        if await self._is_blocked(inviter_id, user_id):
            raise ClubError("USER_NOT_FOUND", 404)

    async def _post_system(self, club_id: uuid.UUID, text: str) -> ClubMessage:
        msg = ClubMessage(club_id=club_id, sender_id=None, text=text)
        self.session.add(msg)
        await self.session.flush()
        return msg

    def _msg_view(self, m: ClubMessage, sender: User | None) -> ClubMessageView:
        return ClubMessageView(
            id=m.id,
            club_id=m.club_id,
            sender_id=m.sender_id,
            sender_name=sender.name if sender else None,
            sender_avatar_url=sender.avatar_url if sender else None,
            text=m.text,
            created_at=m.created_at,
        )

    async def _active_user_ids(self, club_id: uuid.UUID) -> list[uuid.UUID]:
        rows = await self.session.execute(
            select(ClubMember.user_id).where(
                ClubMember.club_id == club_id, ClubMember.status == ACTIVE
            )
        )
        return [r[0] for r in rows.all()]

    async def _broadcast(self, club_id: uuid.UUID, payload: dict[str, Any]) -> None:
        """Deliver to active members connected to this instance + publish for
        other instances (the pub/sub listener resolves members itself)."""
        from app.modules.chat.service import ConnectionManager, publish_club_event

        for uid in await self._active_user_ids(club_id):
            await ConnectionManager.send_to_user(uid, payload)
        try:
            await publish_club_event(club_id, payload)
        except Exception:
            logger.exception("club publish failed")

    async def _changed(self, club_id: uuid.UUID) -> None:
        """Tell connected members to refetch the club (book picks, invites,
        declines…) — changes that don't produce a chat system message."""
        await self._broadcast(club_id, {"type": "club_updated", "club_id": str(club_id)})

    async def _announce(self, msg: ClubMessage) -> None:
        sender = await self.session.get(User, msg.sender_id) if msg.sender_id else None
        view = self._msg_view(msg, sender)
        await self._broadcast(
            msg.club_id,
            {
                "type": "club_message",
                "club_id": str(msg.club_id),
                "message": json.loads(view.model_dump_json()),
            },
        )

    async def _notify(
        self, user_ids: list[uuid.UUID], type_: str, payload: dict[str, Any], title: str, body: str
    ) -> None:
        from app.modules.notifications.service import NotificationService

        notif = NotificationService(self.session)
        for uid in user_ids:
            await notif.notify(
                uid, type_, payload, title=title, body=body, skip_push_if_online=True
            )
        await self.session.commit()

    async def _invalidate_shuffle(self, club: Club, members: list[ClubMember]) -> bool:
        if club.shuffled_at is None:
            return False
        club.shuffled_at = None
        for m in members:
            m.receives_from_user_id = None
        return True

    # ── queries ─────────────────────────────────────────────────────────

    async def detail(self, club_id: uuid.UUID, user_id: uuid.UUID) -> ClubDetail:
        club = await self._get_club(club_id)
        me = await self._require_member(club_id, user_id, OPEN_STATUSES)
        members = [m for m in await self._members(club_id) if m.status in OPEN_STATUSES]
        users = await self._users({m.user_id for m in members})
        book_ids = {m.book_id for m in members if m.book_id}
        books: dict[uuid.UUID, Book] = {}
        thumbs: dict[uuid.UUID, str | None] = {}
        if book_ids:
            rows = await self.session.execute(select(Book).where(Book.id.in_(book_ids)))
            books = {b.id: b for b in rows.scalars().all()}
            prow = await self.session.execute(
                select(BookPhoto.book_id, BookPhoto.thumbnail_url, BookPhoto.url)
                .where(BookPhoto.book_id.in_(book_ids))
                .order_by(BookPhoto.position)
            )
            for bid, thumb, url in prow.all():
                thumbs.setdefault(bid, thumb or url)

        views = []
        for m in members:
            u = users.get(m.user_id)
            b = books.get(m.book_id) if m.book_id else None
            views.append(
                ClubMemberView(
                    user_id=m.user_id,
                    name=u.name if u else "Bilinmeyen",
                    username=u.username if u else None,
                    avatar_url=u.avatar_url if u else None,
                    status=m.status,
                    is_owner=m.user_id == club.owner_id,
                    book=ClubBookView(
                        id=b.id, title=b.title, author=b.author, thumbnail_url=thumbs.get(b.id)
                    )
                    if b and b.deleted_at is None
                    else None,
                    # Assignments are only meaningful to active members.
                    receives_from_user_id=m.receives_from_user_id if me.status == ACTIVE else None,
                )
            )
        blockers = self._shuffle_blockers(members, books)
        return ClubDetail(
            id=club.id,
            name=club.name,
            owner_id=club.owner_id,
            my_status=me.status,
            is_owner=club.owner_id == user_id,
            shuffled_at=club.shuffled_at,
            created_at=club.created_at,
            members=views,
            can_shuffle=club.owner_id == user_id and not blockers,
            shuffle_blockers=blockers,
        )

    @staticmethod
    def _shuffle_blockers(members: list[ClubMember], books: dict[uuid.UUID, Book]) -> list[str]:
        active = [m for m in members if m.status == ACTIVE]
        blockers = []
        if len(active) < 2:
            blockers.append("NEED_TWO_ACTIVE_MEMBERS")
        if any(
            m.book_id is None or m.book_id not in books or books[m.book_id].deleted_at
            for m in active
        ):
            blockers.append("MISSING_BOOKS")
        return blockers

    async def list_mine(self, user_id: uuid.UUID) -> ClubListResponse:
        rows = await self.session.execute(
            select(Club, ClubMember.status)
            .join(ClubMember, ClubMember.club_id == Club.id)
            .where(ClubMember.user_id == user_id, ClubMember.status.in_(OPEN_STATUSES))
            .order_by(Club.created_at.desc())
        )
        pairs = rows.all()
        if not pairs:
            return ClubListResponse(items=[])
        club_ids = [c.id for c, _ in pairs]
        counts = await self.session.execute(
            select(ClubMember.club_id, ClubMember.status, func.count())
            .where(ClubMember.club_id.in_(club_ids))
            .group_by(ClubMember.club_id, ClubMember.status)
        )
        cnt: dict[tuple[uuid.UUID, str], int] = {(c, s): n for c, s, n in counts.all()}
        # latest message per club
        latest_sq = (
            select(ClubMessage.club_id, func.max(ClubMessage.created_at).label("mx"))
            .where(ClubMessage.club_id.in_(club_ids))
            .group_by(ClubMessage.club_id)
            .subquery()
        )
        lrows = await self.session.execute(
            select(ClubMessage).join(
                latest_sq,
                and_(
                    ClubMessage.club_id == latest_sq.c.club_id,
                    ClubMessage.created_at == latest_sq.c.mx,
                ),
            )
        )
        latest = {m.club_id: m for m in lrows.scalars().all()}
        users = await self._users(
            {c.owner_id for c, _ in pairs} | {m.sender_id for m in latest.values() if m.sender_id}
        )
        items = []
        for club, status in pairs:
            lm = latest.get(club.id)
            items.append(
                ClubSummary(
                    id=club.id,
                    name=club.name,
                    owner_id=club.owner_id,
                    owner_name=users[club.owner_id].name if club.owner_id in users else "",
                    my_status=status,
                    active_count=cnt.get((club.id, ACTIVE), 0),
                    invited_count=cnt.get((club.id, INVITED), 0),
                    shuffled_at=club.shuffled_at,
                    created_at=club.created_at,
                    # Invitees don't see the conversation until they accept.
                    last_message=self._msg_view(
                        lm, users.get(lm.sender_id) if lm.sender_id else None
                    )
                    if lm and status == ACTIVE
                    else None,
                )
            )
        return ClubListResponse(items=items)

    async def messages(
        self, club_id: uuid.UUID, user_id: uuid.UUID, before: datetime | None, limit: int
    ) -> ClubMessageListResponse:
        await self._require_member(club_id, user_id)
        stmt = select(ClubMessage).where(ClubMessage.club_id == club_id)
        if before:
            stmt = stmt.where(ClubMessage.created_at < before)
        rows = await self.session.execute(
            stmt.order_by(ClubMessage.created_at.desc()).limit(limit + 1)
        )
        msgs = list(rows.scalars().all())
        has_more = len(msgs) > limit
        msgs = list(reversed(msgs[:limit]))
        users = await self._users({m.sender_id for m in msgs if m.sender_id})
        return ClubMessageListResponse(
            items=[
                self._msg_view(m, users.get(m.sender_id) if m.sender_id else None) for m in msgs
            ],
            has_more=has_more,
        )

    # ── commands ────────────────────────────────────────────────────────

    async def create(self, owner_id: uuid.UUID, body: ClubCreateRequest) -> ClubDetail:
        invitee_ids = list(dict.fromkeys(body.member_ids))  # dedupe, keep order
        club = Club(name=body.name, owner_id=owner_id)
        self.session.add(club)
        await self.session.flush()
        for uid in invitee_ids:
            await self._check_invitee(club, owner_id, uid)
        owner_book = None
        if body.book_id:
            owner_book = await self._own_book(owner_id, body.book_id)
        now = datetime.now(UTC)
        self.session.add(
            ClubMember(
                club_id=club.id,
                user_id=owner_id,
                status=ACTIVE,
                joined_at=now,
                book_id=owner_book.id if owner_book else None,
            )
        )
        for uid in invitee_ids:
            self.session.add(
                ClubMember(club_id=club.id, user_id=uid, status=INVITED, invited_by=owner_id)
            )
        owner = await self.session.get(User, owner_id)
        await self._post_system(
            club.id, f"{owner.name if owner else 'Biri'} “{club.name}” kulübünü kurdu."
        )
        await self.session.commit()
        if invitee_ids:
            await self._notify(
                invitee_ids,
                "club_invite",
                {"club_id": str(club.id), "club_name": club.name},
                "📚 Kitap kulübü daveti",
                f"{owner.name if owner else 'Biri'} seni “{club.name}” kulübüne davet etti",
            )
        return await self.detail(club.id, owner_id)

    async def invite(
        self, club_id: uuid.UUID, owner_id: uuid.UUID, user_id: uuid.UUID
    ) -> ClubDetail:
        club = await self._get_club(club_id)
        if club.owner_id != owner_id:
            raise ClubError("NOT_OWNER", 403)
        await self._check_invitee(club, owner_id, user_id)
        members = await self._members(club_id)
        if sum(m.status in OPEN_STATUSES for m in members) >= MAX_CLUB_MEMBERS:
            raise ClubError("CLUB_FULL", 409)
        existing = next((m for m in members if m.user_id == user_id), None)
        if existing and existing.status in OPEN_STATUSES:
            raise ClubError("ALREADY_MEMBER", 409)
        if existing:  # re-invite someone who declined/left
            existing.status, existing.invited_by, existing.book_id = INVITED, owner_id, None
            existing.receives_from_user_id, existing.joined_at = None, None
        else:
            self.session.add(
                ClubMember(club_id=club_id, user_id=user_id, status=INVITED, invited_by=owner_id)
            )
        await self.session.commit()
        await self._changed(club_id)
        owner = await self.session.get(User, owner_id)
        await self._notify(
            [user_id],
            "club_invite",
            {"club_id": str(club.id), "club_name": club.name},
            "📚 Kitap kulübü daveti",
            f"{owner.name if owner else 'Biri'} seni “{club.name}” kulübüne davet etti",
        )
        return await self.detail(club_id, owner_id)

    async def respond(
        self, club_id: uuid.UUID, user_id: uuid.UUID, accept: bool
    ) -> ClubDetail | None:
        club = await self._get_club(club_id)
        m = await self._require_member(club_id, user_id, (INVITED,))
        user = await self.session.get(User, user_id)
        if accept:
            m.status, m.joined_at = ACTIVE, datetime.now(UTC)
            invalidated = await self._invalidate_shuffle(club, await self._members(club_id))
            text = f"{user.name if user else 'Biri'} kulübe katıldı."
            if invalidated:
                text += " Dağıtım yeni üyeyle yeniden yapılmalı."
            msg = await self._post_system(club_id, text)
            await self.session.commit()
            await self._announce(msg)
            return await self.detail(club_id, user_id)
        m.status = "declined"
        await self.session.commit()
        await self._changed(club_id)
        return None

    async def remove_member(
        self, club_id: uuid.UUID, actor_id: uuid.UUID, user_id: uuid.UUID
    ) -> None:
        """Owner removes someone, or a member leaves (actor == user)."""
        club = await self._get_club(club_id)
        if actor_id != user_id and club.owner_id != actor_id:
            raise ClubError("NOT_OWNER", 403)
        if user_id == club.owner_id:
            raise ClubError("OWNER_CANNOT_LEAVE", 409)  # delete the club instead
        m = await self._require_member(club_id, user_id, OPEN_STATUSES)
        was_active = m.status == ACTIVE
        m.status = "left" if actor_id == user_id else "declined"
        m.book_id = None
        members = await self._members(club_id)
        msg = None
        if was_active:
            invalidated = await self._invalidate_shuffle(club, members)
            user = await self.session.get(User, user_id)
            verb = "kulüpten ayrıldı" if actor_id == user_id else "kulüpten çıkarıldı"
            text = f"{user.name if user else 'Biri'} {verb}."
            if invalidated:
                text += " Kitap dağıtımı sıfırlandı."
            msg = await self._post_system(club_id, text)
        await self.session.commit()
        if msg:
            await self._announce(msg)
        else:
            await self._changed(club_id)

    async def delete(self, club_id: uuid.UUID, actor_id: uuid.UUID) -> None:
        club = await self._get_club(club_id)
        if club.owner_id != actor_id:
            raise ClubError("NOT_OWNER", 403)
        recipients = await self._active_user_ids(club_id)
        await self.session.delete(club)
        await self.session.commit()
        from app.modules.chat.service import ConnectionManager

        for uid in recipients:
            await ConnectionManager.send_to_user(
                uid, {"type": "club_deleted", "club_id": str(club_id)}
            )

    async def _own_book(self, user_id: uuid.UUID, book_id: uuid.UUID) -> Book:
        book = await self.session.get(Book, book_id)
        if book is None or book.owner_id != user_id or book.deleted_at is not None:
            raise ClubError("BOOK_NOT_FOUND", 404)
        return book

    async def set_my_book(
        self, club_id: uuid.UUID, user_id: uuid.UUID, book_id: uuid.UUID | None
    ) -> ClubDetail:
        m = await self._require_member(club_id, user_id)
        if book_id is not None:
            await self._own_book(user_id, book_id)
        m.book_id = book_id
        await self.session.commit()
        await self._changed(club_id)
        return await self.detail(club_id, user_id)

    async def shuffle(self, club_id: uuid.UUID, owner_id: uuid.UUID) -> ClubDetail:
        club = await self._get_club(club_id)
        if club.owner_id != owner_id:
            raise ClubError("NOT_OWNER", 403)
        members = [m for m in await self._members(club_id) if m.status in OPEN_STATUSES]
        book_ids = {m.book_id for m in members if m.book_id}
        books = {}
        if book_ids:
            rows = await self.session.execute(select(Book).where(Book.id.in_(book_ids)))
            books = {b.id: b for b in rows.scalars().all()}
        blockers = self._shuffle_blockers(members, books)
        if blockers:
            raise ClubError(blockers[0], 409)
        active = [m for m in members if m.status == ACTIVE]
        mapping = derangement([m.user_id for m in active])
        for m in active:
            m.receives_from_user_id = mapping[m.user_id]
        club.shuffled_at = datetime.now(UTC)
        msg = await self._post_system(
            club_id, "🎲 Kitaplar karıştırıldı! Herkes kime hangi kitabın düştüğünü görebilir."
        )
        await self.session.commit()
        await self._announce(msg)
        others = [m.user_id for m in active if m.user_id != owner_id]
        if others:
            await self._notify(
                others,
                "club_shuffled",
                {"club_id": str(club.id), "club_name": club.name},
                "🎲 Kitaplar karıştırıldı",
                f"“{club.name}” kulübünde sana hangi kitap düştü? Hemen bak!",
            )
        return await self.detail(club_id, owner_id)

    async def post_message(
        self, club_id: uuid.UUID, user_id: uuid.UUID, text: str
    ) -> ClubMessageView:
        await self._require_member(club_id, user_id)
        text = text.strip()
        if not text:
            raise ClubError("EMPTY_MESSAGE", 400)
        msg = ClubMessage(club_id=club_id, sender_id=user_id, text=text)
        self.session.add(msg)
        await self.session.commit()
        sender = await self.session.get(User, user_id)
        view = self._msg_view(msg, sender)
        await self._broadcast(
            club_id,
            {
                "type": "club_message",
                "club_id": str(club_id),
                "message": json.loads(view.model_dump_json()),
                "sender_id": str(user_id),
            },
        )
        # Push to members who are offline (in-app notification list stays quiet
        # for chat-like traffic, matching 1:1 chat behaviour).
        from app.modules.chat.service import ConnectionManager
        from app.modules.notifications.service import NotificationService

        club = await self.session.get(Club, club_id)
        notif = NotificationService(self.session)
        for uid in await self._active_user_ids(club_id):
            if uid == user_id or await ConnectionManager.check_online(uid):
                continue
            await notif.notify(
                uid,
                "club_message",
                {"club_id": str(club_id)},
                title=f"{club.name if club else 'Kulüp'} · {sender.name if sender else ''}",
                body=text[:120],
                inbox=False,
            )
        await self.session.commit()
        return view
