"""Unit tests for borrow-mode state machine transitions (pure, no DB)."""

import uuid

import pytest

from app.modules.exchanges.models import ExchangeStatus
from app.modules.exchanges.state_machine import (
    Actor,
    ExchangeAction,
    TransitionError,
    check_actor,
    get_transition,
)


def test_meetup_confirmed_to_lent():
    nxt, actor = get_transition(ExchangeStatus.meetup_confirmed, ExchangeAction.mark_lent)
    assert nxt == ExchangeStatus.lent
    assert actor == Actor.EITHER


def test_lent_to_return_pending_requires_requester():
    nxt, actor = get_transition(ExchangeStatus.lent, ExchangeAction.mark_returned)
    assert nxt == ExchangeStatus.return_pending
    assert actor == Actor.REQUESTER


def test_overdue_can_still_be_returned():
    nxt, _ = get_transition(ExchangeStatus.overdue, ExchangeAction.mark_returned)
    assert nxt == ExchangeStatus.return_pending


def test_confirm_return_requires_owner():
    nxt, actor = get_transition(ExchangeStatus.return_pending, ExchangeAction.confirm_return)
    assert nxt == ExchangeStatus.completed
    assert actor == Actor.OWNER


def test_approve_extension_from_overdue_reactivates_loan():
    nxt, actor = get_transition(ExchangeStatus.overdue, ExchangeAction.approve_extension)
    assert nxt == ExchangeStatus.lent
    assert actor == Actor.OWNER


def test_invalid_transition_raises():
    with pytest.raises(TransitionError):
        get_transition(ExchangeStatus.pending, ExchangeAction.confirm_return)


def test_actor_checks():
    requester = uuid.uuid7()
    owner = uuid.uuid7()
    assert check_actor(Actor.REQUESTER, requester, requester, owner, None) is True
    assert check_actor(Actor.REQUESTER, owner, requester, owner, None) is False
    assert check_actor(Actor.OWNER, owner, requester, owner, None) is True
    assert check_actor(Actor.EITHER, owner, requester, owner, None) is True
