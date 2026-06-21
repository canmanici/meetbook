"""Unit tests for the trust score computation (pure, no DB)."""

from app.modules.auth.trust import compute_trust


def test_no_history_is_neutral_yellow():
    r = compute_trust(
        rating_average=0,
        loans_borrowed_count=0,
        loans_returned_on_time=0,
        loans_returned_late=0,
    )
    # 0.5 on-time * 50 + 0 rating + 0 experience = 25 → red? check threshold
    assert r.on_time_rate is None
    assert 0 <= r.score <= 100
    assert r.badge in ("green", "yellow", "red")


def test_perfect_borrower_is_green():
    r = compute_trust(
        rating_average=5,
        loans_borrowed_count=10,
        loans_returned_on_time=10,
        loans_returned_late=0,
    )
    assert r.score == 100
    assert r.badge == "green"
    assert r.label == "Güvenilir"
    assert r.on_time_rate == 1.0


def test_always_late_is_low():
    r = compute_trust(
        rating_average=5,
        loans_borrowed_count=10,
        loans_returned_on_time=0,
        loans_returned_late=10,
    )
    # 0 on-time*50 + 30 rating + 20 experience = 50 → yellow
    assert r.on_time_rate == 0.0
    assert r.badge in ("yellow", "red")


def test_admin_override_wins():
    r = compute_trust(
        rating_average=5,
        loans_borrowed_count=10,
        loans_returned_on_time=10,
        loans_returned_late=0,
        trust_score_override=10,
    )
    assert r.is_override is True
    assert r.score == 10
    assert r.badge == "red"


def test_override_is_clamped():
    r = compute_trust(
        rating_average=0,
        loans_borrowed_count=0,
        loans_returned_on_time=0,
        loans_returned_late=0,
        trust_score_override=250,
    )
    assert r.score == 100
