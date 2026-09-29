"""What may appear in a listing.

MeetBook moves books for credits only — never for money. A listing that
carries a price, an IBAN or a phone number is someone trying to sell (or to
pull the deal off-platform, where none of our safety or deposit rules apply).
That is exactly how a teacher would turn "required course book" into income,
so the rule applies to everyone, teachers included.
"""

import re

# Folded to lower-case ASCII-ish before matching (see _fold).
_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("price", re.compile(r"\d[\d.,]*\s*(tl|try|lira|₺)\b|₺\s*\d")),
    ("iban", re.compile(r"\btr\s*\d{2}(\s*\d{4}){5}\s*\d{2}\b")),
    # Not inside a longer digit run (ISBNs are full of 5xx sequences).
    (
        "phone",
        re.compile(r"(?<![\d])(\+?90|0)?\s*\(?5\d{2}\)?[\s.-]*\d{3}[\s.-]*\d{2}[\s.-]*\d{2}(?!\d)"),
    ),
    (
        "sale",
        re.compile(
            r"\b(satılık|satiyorum|satıyorum|satilik|fiyat[ıi]?|ücret(li)?|ucret(li)?|"
            r"param|parayla|havale|eft|papara|iban)\b"
        ),
    ),
)


def _fold(text: str) -> str:
    return text.replace("İ", "i").replace("I", "ı").lower()


def commercial_content(*texts: str | None) -> str | None:
    """Return the kind of commercial content found ('price', 'iban', ...), or None."""
    for text in texts:
        if not text:
            continue
        folded = _fold(text)
        for kind, pattern in _PATTERNS:
            if pattern.search(folded):
                return kind
    return None


_COURSE_FOLD = str.maketrans("ıİşŞçÇöÖüÜğĞ", "IISSCCOOUUGG")
_COURSE_RE = re.compile(r"^(?=.*[A-Z])(?=.*\d)[A-Z0-9]{3,12}$")


def normalize_course_code(raw: str) -> str:
    """'mat 101', 'MAT-101', 'Mat101' → 'MAT101'. Raises ValueError if it doesn't
    look like a course code (letters + digits, 3-12 chars)."""
    code = re.sub(r"[\s\-_./]", "", raw.translate(_COURSE_FOLD)).upper()
    if not _COURSE_RE.match(code):
        raise ValueError("INVALID_COURSE_CODE")
    return code
