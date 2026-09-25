"""Exchange request state machine.

Single source of truth for legal transitions, per
docs/superpowers/specs/2026-06-13-phase4-exchange-lifecycle-design.md §2.
"""

import enum
import uuid

from app.modules.exchanges.models import ExchangeStatus


class ExchangeAction(str, enum.Enum):
    accept = "accept"
    reject = "reject"
    cancel = "cancel"
    complete = "complete"
    confirm_completion = "confirm_completion"
    propose_meetup = "propose_meetup"
    accept_meetup = "accept_meetup"
    reject_meetup = "reject_meetup"
    # Borrow-mode actions
    mark_lent = "mark_lent"  # book handed over → lent
    mark_returned = "mark_returned"  # borrower returned → return_pending
    confirm_return = "confirm_return"  # owner confirms → completed
    request_extension = "request_extension"
    approve_extension = "approve_extension"
    reject_extension = "reject_extension"


class Actor(str, enum.Enum):
    REQUESTER = "requester"
    OWNER = "owner"
    EITHER = "either"
    OTHER_PARTICIPANT = "other_participant"


# (current status, action) -> (next status, allowed actor)
TRANSITIONS: dict[tuple[ExchangeStatus, ExchangeAction], tuple[ExchangeStatus, Actor]] = {
    (ExchangeStatus.pending, ExchangeAction.accept): (ExchangeStatus.accepted, Actor.OWNER),
    (ExchangeStatus.pending, ExchangeAction.reject): (ExchangeStatus.rejected, Actor.OWNER),
    (ExchangeStatus.pending, ExchangeAction.cancel): (ExchangeStatus.cancelled, Actor.REQUESTER),
    (ExchangeStatus.accepted, ExchangeAction.cancel): (ExchangeStatus.cancelled, Actor.EITHER),
    (ExchangeStatus.accepted, ExchangeAction.complete): (
        ExchangeStatus.completion_pending,
        Actor.EITHER,
    ),
    (ExchangeStatus.completion_pending, ExchangeAction.confirm_completion): (
        ExchangeStatus.completed,
        Actor.OTHER_PARTICIPANT,
    ),
    (ExchangeStatus.completion_pending, ExchangeAction.cancel): (
        ExchangeStatus.cancelled,
        Actor.EITHER,
    ),
    (ExchangeStatus.accepted, ExchangeAction.propose_meetup): (
        ExchangeStatus.meetup_proposed,
        Actor.EITHER,
    ),
    (ExchangeStatus.meetup_proposed, ExchangeAction.propose_meetup): (
        ExchangeStatus.meetup_proposed,
        Actor.EITHER,
    ),
    (ExchangeStatus.meetup_confirmed, ExchangeAction.propose_meetup): (
        ExchangeStatus.meetup_proposed,
        Actor.EITHER,
    ),
    (ExchangeStatus.meetup_proposed, ExchangeAction.accept_meetup): (
        ExchangeStatus.meetup_confirmed,
        Actor.EITHER,
    ),
    (ExchangeStatus.meetup_proposed, ExchangeAction.reject_meetup): (
        ExchangeStatus.accepted,
        Actor.EITHER,
    ),
    (ExchangeStatus.meetup_proposed, ExchangeAction.cancel): (
        ExchangeStatus.cancelled,
        Actor.EITHER,
    ),
    (ExchangeStatus.meetup_confirmed, ExchangeAction.cancel): (
        ExchangeStatus.cancelled,
        Actor.EITHER,
    ),
    (ExchangeStatus.meetup_confirmed, ExchangeAction.complete): (
        ExchangeStatus.completion_pending,
        Actor.EITHER,
    ),
    # --- Borrow-mode lifecycle ---
    # Book handed over at the confirmed meetup → on loan. Either party may mark it.
    (ExchangeStatus.meetup_confirmed, ExchangeAction.mark_lent): (
        ExchangeStatus.lent,
        Actor.EITHER,
    ),
    # Borrower returns the book → awaiting owner confirmation.
    (ExchangeStatus.lent, ExchangeAction.mark_returned): (
        ExchangeStatus.return_pending,
        Actor.REQUESTER,
    ),
    (ExchangeStatus.overdue, ExchangeAction.mark_returned): (
        ExchangeStatus.return_pending,
        Actor.REQUESTER,
    ),
    # Owner confirms the returned book → loan completed.
    (ExchangeStatus.return_pending, ExchangeAction.confirm_return): (
        ExchangeStatus.completed,
        Actor.OWNER,
    ),
    # Extension request/response keep the loan in place.
    (ExchangeStatus.lent, ExchangeAction.request_extension): (
        ExchangeStatus.lent,
        Actor.REQUESTER,
    ),
    (ExchangeStatus.overdue, ExchangeAction.request_extension): (
        ExchangeStatus.overdue,
        Actor.REQUESTER,
    ),
    (ExchangeStatus.lent, ExchangeAction.approve_extension): (
        ExchangeStatus.lent,
        Actor.OWNER,
    ),
    (ExchangeStatus.overdue, ExchangeAction.approve_extension): (
        ExchangeStatus.lent,
        Actor.OWNER,
    ),
    (ExchangeStatus.lent, ExchangeAction.reject_extension): (
        ExchangeStatus.lent,
        Actor.OWNER,
    ),
    (ExchangeStatus.overdue, ExchangeAction.reject_extension): (
        ExchangeStatus.overdue,
        Actor.OWNER,
    ),
    # Cancel an active loan (e.g. lost book dispute) — OWNER only. If the
    # borrower could cancel, they'd walk away with the book and a clean
    # record; an owner-cancel is recorded against the borrower as a late
    # (unreturned) loan in ExchangeService._transition.
    (ExchangeStatus.lent, ExchangeAction.cancel): (ExchangeStatus.cancelled, Actor.OWNER),
    (ExchangeStatus.overdue, ExchangeAction.cancel): (ExchangeStatus.cancelled, Actor.OWNER),
}

# Statuses the hourly expiry worker may move to `expired` once `expires_at` has passed.
EXPIRABLE_STATUSES = (ExchangeStatus.pending, ExchangeStatus.accepted)


class TransitionError(Exception):
    def __init__(self, code: str, status_code: int = 409) -> None:
        self.code = code
        self.status_code = status_code


def get_transition(
    current_status: ExchangeStatus, action: ExchangeAction
) -> tuple[ExchangeStatus, Actor]:
    """Return (next_status, allowed_actor) for a transition, or raise TransitionError."""
    transition = TRANSITIONS.get((current_status, action))
    if transition is None:
        raise TransitionError("INVALID_TRANSITION", 409)
    return transition


def check_actor(
    actor: Actor,
    current_user_id: uuid.UUID,
    requested_by: uuid.UUID,
    requested_to: uuid.UUID,
    completion_marked_by: uuid.UUID | None,
) -> bool:
    """Return True if current_user_id is allowed to perform a transition with this actor rule."""
    if actor is Actor.REQUESTER:
        return current_user_id == requested_by
    if actor is Actor.OWNER:
        return current_user_id == requested_to
    if actor is Actor.EITHER:
        return current_user_id in (requested_by, requested_to)
    if actor is Actor.OTHER_PARTICIPANT:
        return current_user_id in (requested_by, requested_to) and (
            current_user_id != completion_marked_by
        )
    return False
