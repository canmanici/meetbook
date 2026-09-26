"""Current KVKK / privacy policy version — single source: app/legal/VERSION."""

from datetime import datetime, timedelta
from pathlib import Path

_VERSION_FILE = Path(__file__).resolve().parent.parent / "legal" / "VERSION"


def current_policy_version() -> str:
    try:
        return _VERSION_FILE.read_text(encoding="utf-8").strip() or "1.0"
    except FileNotFoundError:
        return "1.0"


def add_business_days(start: datetime, days: int) -> datetime:
    """start + N working days (Mon–Fri). Public holidays are not modelled;
    admins see the computed due date and can close earlier."""
    d = start
    added = 0
    while added < days:
        d += timedelta(days=1)
        if d.weekday() < 5:
            added += 1
    return d
