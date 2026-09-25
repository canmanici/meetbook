"""Verify Google ID tokens (Sign in with Google).

Uses Google's official tokeninfo endpoint, which checks the signature and
expiry server-side; we then enforce audience (our client IDs) and issuer.
One HTTPS round-trip per login — fine for login frequency, no crypto deps.
"""

import logging
from dataclasses import dataclass

import httpx

from app.core.config import get_settings

logger = logging.getLogger(__name__)

TOKENINFO_URL = "https://oauth2.googleapis.com/tokeninfo"
VALID_ISSUERS = {"accounts.google.com", "https://accounts.google.com"}


class GoogleAuthError(Exception):
    pass


@dataclass
class GoogleIdentity:
    sub: str
    email: str
    email_verified: bool
    name: str | None
    picture: str | None


async def verify_google_id_token(id_token: str) -> GoogleIdentity:
    allowed = get_settings().google_client_ids_list
    if not allowed:
        raise GoogleAuthError("GOOGLE_NOT_CONFIGURED")
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(TOKENINFO_URL, params={"id_token": id_token})
    except httpx.HTTPError as e:
        logger.warning("Google tokeninfo unreachable: %s", e)
        raise GoogleAuthError("GOOGLE_UNAVAILABLE") from e
    if resp.status_code != 200:
        raise GoogleAuthError("INVALID_GOOGLE_TOKEN")
    data = resp.json()
    if data.get("aud") not in allowed:
        raise GoogleAuthError("INVALID_GOOGLE_TOKEN")
    if data.get("iss") not in VALID_ISSUERS or not data.get("sub") or not data.get("email"):
        raise GoogleAuthError("INVALID_GOOGLE_TOKEN")
    return GoogleIdentity(
        sub=str(data["sub"]),
        email=str(data["email"]).strip().lower(),
        email_verified=str(data.get("email_verified", "")).lower() == "true",
        name=data.get("name"),
        picture=data.get("picture"),
    )
