"""Unit tests for the exchange state machine — the full transition matrix."""

import itertools
import uuid

import pytest

from app.modules.exchanges.models import ExchangeStatus
from app.modules.exchanges.state_machine import (
    TRANSITIONS,
    Actor,
    ExchangeAction,
    TransitionError,
    check_actor,
    get_transition,
)

REQUESTER = uuid.uuid7()
OWNER = uuid.uuid7()
STRANGER = uuid.uuid7()


@pytest.mark.parametrize(
    ("status", "action"),
    itertools.product(ExchangeStatus, ExchangeAction),
)
def test_full_transition_matrix(status: ExchangeStatus, action: ExchangeAction) -> None:
    """Every (status, action) pair is either a defined transition or INVALID_TRANSITION."""
    if (status, action) in TRANSITIONS:
        next_status, actor = get_transition(status, action)
        assert next_status in ExchangeStatus
        assert actor in Actor
    else:
        with pytest.raises(TransitionError) as exc_info:
            get_transition(status, action)
        assert exc_info.value.code == "INVALID_TRANSITION"
        assert exc_info.value.status_code == 409


def test_pending_accept_only_owner() -> None:
    _, actor = get_transition(ExchangeStatus.pending, ExchangeAction.accept)
    assert actor is Actor.OWNER
    assert check_actor(actor, OWNER, REQUESTER, OWNER, None) is True
    assert check_actor(actor, REQUESTER, REQUESTER, OWNER, None) is False
    assert check_actor(actor, STRANGER, REQUESTER, OWNER, None) is False


def test_pending_reject_only_owner() -> None:
    _, actor = get_transition(ExchangeStatus.pending, ExchangeAction.reject)
    assert actor is Actor.OWNER
    assert check_actor(actor, OWNER, REQUESTER, OWNER, None) is True
    assert check_actor(actor, REQUESTER, REQUESTER, OWNER, None) is False


def test_pending_cancel_only_requester() -> None:
    _, actor = get_transition(ExchangeStatus.pending, ExchangeAction.cancel)
    assert actor is Actor.REQUESTER
    assert check_actor(actor, REQUESTER, REQUESTER, OWNER, None) is True
    assert check_actor(actor, OWNER, REQUESTER, OWNER, None) is False


def test_accepted_cancel_either_participant() -> None:
    _, actor = get_transition(ExchangeStatus.accepted, ExchangeAction.cancel)
    assert actor is Actor.EITHER
    assert check_actor(actor, REQUESTER, REQUESTER, OWNER, None) is True
    assert check_actor(actor, OWNER, REQUESTER, OWNER, None) is True
    assert check_actor(actor, STRANGER, REQUESTER, OWNER, None) is False


def test_accepted_complete_either_participant() -> None:
    next_status, actor = get_transition(ExchangeStatus.accepted, ExchangeAction.complete)
    assert next_status == ExchangeStatus.completion_pending
    assert actor is Actor.EITHER
    assert check_actor(actor, REQUESTER, REQUESTER, OWNER, None) is True
    assert check_actor(actor, OWNER, REQUESTER, OWNER, None) is True


def test_completion_pending_confirm_only_other_participant() -> None:
    next_status, actor = get_transition(
        ExchangeStatus.completion_pending, ExchangeAction.confirm_completion
    )
    assert next_status == ExchangeStatus.completed
    assert actor is Actor.OTHER_PARTICIPANT

    # requester marked completion -> only owner can confirm
    assert check_actor(actor, OWNER, REQUESTER, OWNER, completion_marked_by=REQUESTER) is True
    assert check_actor(actor, REQUESTER, REQUESTER, OWNER, completion_marked_by=REQUESTER) is False
    assert check_actor(actor, STRANGER, REQUESTER, OWNER, completion_marked_by=REQUESTER) is False


def test_completion_pending_cancel_either_participant() -> None:
    next_status, actor = get_transition(ExchangeStatus.completion_pending, ExchangeAction.cancel)
    assert next_status == ExchangeStatus.cancelled
    assert actor is Actor.EITHER
    assert check_actor(actor, REQUESTER, REQUESTER, OWNER, None) is True
    assert check_actor(actor, OWNER, REQUESTER, OWNER, None) is True


@pytest.mark.parametrize(
    ("status", "action"),
    [
        (ExchangeStatus.rejected, ExchangeAction.accept),
        (ExchangeStatus.rejected, ExchangeAction.reject),
        (ExchangeStatus.rejected, ExchangeAction.cancel),
        (ExchangeStatus.rejected, ExchangeAction.complete),
        (ExchangeStatus.rejected, ExchangeAction.confirm_completion),
        (ExchangeStatus.cancelled, ExchangeAction.accept),
        (ExchangeStatus.cancelled, ExchangeAction.complete),
        (ExchangeStatus.completed, ExchangeAction.complete),
        (ExchangeStatus.completed, ExchangeAction.confirm_completion),
        (ExchangeStatus.expired, ExchangeAction.accept),
        (ExchangeStatus.expired, ExchangeAction.cancel),
        (ExchangeStatus.pending, ExchangeAction.complete),
        (ExchangeStatus.pending, ExchangeAction.confirm_completion),
        (ExchangeStatus.accepted, ExchangeAction.accept),
        (ExchangeStatus.accepted, ExchangeAction.confirm_completion),
        (ExchangeStatus.completion_pending, ExchangeAction.complete),
    ],
)
def test_terminal_and_illegal_transitions_rejected(
    status: ExchangeStatus, action: ExchangeAction
) -> None:
    with pytest.raises(TransitionError) as exc_info:
        get_transition(status, action)
    assert exc_info.value.code == "INVALID_TRANSITION"
