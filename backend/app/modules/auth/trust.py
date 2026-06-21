"""Trust score computation for the lending/borrowing system.

The trust score is a 0-100 value combining three signals, with a coloured badge
the book owner sees before approving a loan:

  * on-time return rate (50%) — the most important signal for lending
  * rating average        (30%) — 1-5 star reputation from completed exchanges
  * experience            (20%) — how many loans the user has borrowed before

Admins can override the computed score (``User.trust_score_override``); when set,
that value wins and the badge is derived from it.
"""

from __future__ import annotations

from dataclasses import dataclass

# Weights must sum to 1.0.
_WEIGHT_ON_TIME = 0.5
_WEIGHT_RATING = 0.3
_WEIGHT_EXPERIENCE = 0.2

# Neutral on-time rate used when a user has not returned any loans yet.
_NEUTRAL_ON_TIME = 0.5
# Number of borrows at which the experience signal saturates to 1.0.
_EXPERIENCE_SATURATION = 10

GREEN_THRESHOLD = 75
YELLOW_THRESHOLD = 40


@dataclass(frozen=True)
class TrustResult:
    score: int  # 0-100
    badge: str  # "green" | "yellow" | "red"
    label: str  # Turkish human-readable label
    on_time_rate: float | None  # None when no loan history yet
    loans_borrowed_count: int
    is_override: bool


def _badge_for(score: float) -> tuple[str, str]:
    if score >= GREEN_THRESHOLD:
        return "green", "Güvenilir"
    if score >= YELLOW_THRESHOLD:
        return "yellow", "Orta"
    return "red", "Riskli"


def compute_trust(
    *,
    rating_average: float,
    loans_borrowed_count: int,
    loans_returned_on_time: int,
    loans_returned_late: int,
    trust_score_override: float | None = None,
) -> TrustResult:
    """Compute a user's trust score and badge."""
    total_returned = loans_returned_on_time + loans_returned_late
    on_time_rate = (loans_returned_on_time / total_returned) if total_returned > 0 else None

    if trust_score_override is not None:
        score = max(0.0, min(100.0, float(trust_score_override)))
        badge, label = _badge_for(score)
        return TrustResult(
            score=round(score),
            badge=badge,
            label=label,
            on_time_rate=on_time_rate,
            loans_borrowed_count=loans_borrowed_count,
            is_override=True,
        )

    on_time_component = on_time_rate if on_time_rate is not None else _NEUTRAL_ON_TIME
    rating_component = max(0.0, min(1.0, float(rating_average) / 5.0))
    experience_component = min(1.0, loans_borrowed_count / _EXPERIENCE_SATURATION)

    raw = (
        _WEIGHT_ON_TIME * on_time_component
        + _WEIGHT_RATING * rating_component
        + _WEIGHT_EXPERIENCE * experience_component
    )
    score = round(raw * 100)
    badge, label = _badge_for(score)
    return TrustResult(
        score=score,
        badge=badge,
        label=label,
        on_time_rate=on_time_rate,
        loans_borrowed_count=loans_borrowed_count,
        is_override=False,
    )
