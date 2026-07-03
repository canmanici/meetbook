"""Legal endpoints — serve privacy policy, terms, KVKK documents, and consent management."""

import logging
import uuid
from datetime import UTC, datetime
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_session
from app.modules.auth.dependencies import get_current_user
from app.modules.auth.models import User
from app.modules.legal.schemas import (
    AcceptPolicyRequest,
    AcceptPolicyResponse,
    CurrentPolicyResponse,
    DataSubjectRequest,
    DataSubjectResponse,
)

logger = logging.getLogger("app.legal")

# --- Current policy version (read from VERSION file) ---
_legal_dir = Path(__file__).resolve().parent.parent.parent / "legal"
_version_file = _legal_dir / "VERSION"

def _get_current_policy_version() -> str:
    try:
        return _version_file.read_text(encoding="utf-8").strip()
    except FileNotFoundError:
        return "1.0"  # fallback


router = APIRouter(prefix="/legal", tags=["legal"])


# ── HTML pages ────────────────────────────────────────────────

def _read_html(filename: str) -> str:
    """Read an HTML file from the legal directory and return its content."""
    path = _legal_dir / filename
    if not path.exists():
        raise HTTPException(status_code=404, detail="Belge bulunamadı.")
    return path.read_text(encoding="utf-8")


@router.get("/gizlilik-politikasi", response_class=HTMLResponse, include_in_schema=False)
async def gizlilik_politikasi() -> str:
    return _read_html("gizlilik-politikasi.html")


@router.get("/kullanim-kosullari", response_class=HTMLResponse, include_in_schema=False)
async def kullanim_kosullari() -> str:
    return _read_html("kullanim-kosullari.html")


@router.get("/kvkk-aydinlatma-metni", response_class=HTMLResponse, include_in_schema=False)
async def kvkk_aydinlatma_metni() -> str:
    return _read_html("kvkk-aydinlatma-metni.html")


@router.get("/cerez-politikasi", response_class=HTMLResponse, include_in_schema=False)
async def cerez_politikasi() -> str:
    return _read_html("cerez-politikasi.html")


@router.get("/veri-sahibi-basvuru", response_class=HTMLResponse, include_in_schema=False)
async def veri_sahibi_basvuru_formu() -> str:
    return _read_html("veri-sahibi-basvuru.html")


@router.get("/veri-saklama-imha-politikasi", response_class=HTMLResponse, include_in_schema=False)
async def veri_saklama_imha_politikasi() -> str:
    return _read_html("veri-saklama-imha-politikasi.html")


@router.get("/kotuye-kullanim-ve-dolandiricilikla-mucadele-politikasi", response_class=HTMLResponse, include_in_schema=False)
async def kotuye_kullanim_ve_dolandiricilikla_mucadele_politikasi() -> str:
    return _read_html("kotuye-kullanim-ve-dolandiricilikla-mucadele-politikasi.html")


# ── API endpoints ────────────────────────────────────────────

@router.get("/current-policy", response_model=CurrentPolicyResponse)
async def current_policy(user: User = Depends(get_current_user)) -> CurrentPolicyResponse:
    """Return the current policy version and whether the user has accepted it."""
    current = _get_current_policy_version()
    return CurrentPolicyResponse(
        current_version=current,
        user_accepted_version=user.kvkk_policy_version,
        accepted=user.kvkk_policy_version == current,
    )


@router.post("/accept-policy", response_model=AcceptPolicyResponse)
async def accept_policy(
    body: AcceptPolicyRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> AcceptPolicyResponse:
    """Accept the current (or a specific) policy version."""
    current = _get_current_policy_version()
    if body.version != current:
        # Allow accepting a specific version, but warn if it's not current
        logger.warning(
            "User %s accepted non-current version %s (current: %s)",
            user.id, body.version, current,
        )

    user.kvkk_policy_version = body.version
    user.kvkk_consent_at = datetime.now(UTC)
    session.add(user)
    await session.commit()

    logger.info("User %s accepted policy version %s", user.id, body.version)
    return AcceptPolicyResponse(
        success=True,
        accepted_version=body.version,
        message=f"Politika sürümü {body.version} başarıyla onaylandı.",
    )


@router.get("/current-policy-public")
async def current_policy_public() -> dict:
    """Public endpoint for policy version check (no auth needed)."""
    current = _get_current_policy_version()
    return {
        "current_version": current,
        "privacy_policy_url": "/legal/gizlilik-politikasi",
        "disclosure_url": "/legal/kvkk-aydinlatma-metni",
        "terms_url": "/legal/kullanim-kosullari",
        "fraud_policy_url": "/legal/kotuye-kullanim-ve-dolandiricilikla-mucadele-politikasi",
    }


@router.post("/veri-sahibi-basvuru", response_model=DataSubjectResponse)
async def submit_data_subject_request(
    body: DataSubjectRequest,
) -> DataSubjectResponse:
    """Submit a KVKK data subject access request."""
    ref = str(uuid.uuid7())[:8].upper()
    logger.info(
        "KVKK veri sahibi başvurusu alındı | ref=%s | eposta=%s | kullanici=%s | tur=%s",
        ref, body.eposta, body.kullaniciadi, body.basvuruTuru,
    )
    # In production, this would send an email to the data controller
    # For now, we log it and acknowledge receipt
    return DataSubjectResponse(
        success=True,
        message=f"Başvurunuz başarıyla alınmıştır. Referans numaranız: {ref}. "
                f"En geç 30 gün içinde {body.eposta} adresine yanıt verilecektir.",
        reference_number=ref,
    )
