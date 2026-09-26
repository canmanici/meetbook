"""Legal endpoints — serve privacy policy, terms, KVKK documents, and consent management."""

import logging
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.db import get_session
from app.core.mailer import send_mail
from app.core.policy import add_business_days, current_policy_version
from app.modules.auth.dependencies import get_current_user
from app.modules.auth.models import User
from app.modules.legal.models import DataSubjectRequestRecord
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
    return current_policy_version()


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


@router.get(
    "/kotuye-kullanim-ve-dolandiricilikla-mucadele-politikasi",
    response_class=HTMLResponse,
    include_in_schema=False,
)
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
            user.id,
            body.version,
            current,
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
async def current_policy_public() -> dict[str, Any]:
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
    session: AsyncSession = Depends(get_session),
) -> DataSubjectResponse:
    """Submit a KVKK data subject request — persisted, acknowledged by email,
    and forwarded to the data controller inbox (if configured)."""
    ref = str(uuid.uuid7()).replace("-", "")[-8:].upper()
    now = datetime.now(UTC)
    session.add(
        DataSubjectRequestRecord(
            reference=ref,
            full_name=body.adsoyad,
            email=str(body.eposta),
            phone=body.telefon,
            username=body.kullaniciadi,
            request_type=body.basvuruTuru,
            description=body.talepAciklama,
            extra_info=body.ekBilgi,
            identity_method=body.kimlikDogrulama,
            due_at=now + timedelta(days=30),
        )
    )
    await session.commit()
    logger.info("KVKK veri sahibi başvurusu kaydedildi | ref=%s | tur=%s", ref, body.basvuruTuru)

    await send_mail(
        str(body.eposta),
        f"KVKK başvurunuz alındı — {ref}",
        f"Sayın {body.adsoyad},\n\nKVKK kapsamındaki başvurunuz alınmıştır.\n"
        f"Referans numaranız: {ref}\n\nBaşvurunuz en geç 30 gün içinde yanıtlanacaktır.\n\n— MeetBook",
    )
    controller = get_settings().kvkk_controller_email
    if controller:
        await send_mail(
            controller,
            f"[KVKK] Yeni veri sahibi başvurusu {ref} — {body.basvuruTuru}",
            f"Referans: {ref}\nAd Soyad: {body.adsoyad}\nE-posta: {body.eposta}\n"
            f"Telefon: {body.telefon or '-'}\nKullanıcı adı: {body.kullaniciadi}\n"
            f"Tür: {body.basvuruTuru}\nKimlik doğrulama: {body.kimlikDogrulama}\n"
            f"Son yanıt tarihi: {(now + timedelta(days=30)).date().isoformat()}\n\n"
            f"Talep:\n{body.talepAciklama}\n\nEk bilgi:\n{body.ekBilgi or '-'}",
        )
    return DataSubjectResponse(
        success=True,
        message=f"Başvurunuz başarıyla alınmıştır. Referans numaranız: {ref}. "
        f"En geç 30 gün içinde {body.eposta} adresine yanıt verilecektir.",
        reference_number=ref,
    )


# ── In-app data deletion request ─────────────────────────────
# Signed-in users ask for their data to be erased from Settings; the request
# joins the KVKK queue (admin → KVKK Başvuruları) with a 30-business-day due
# date, as promised in the Aydınlatma Metni.

privacy_router = APIRouter(prefix="/privacy", tags=["privacy"])

DELETION_REQUEST_TYPE = "Verilerimin silinmesi (uygulama içi)"
DELETION_BUSINESS_DAYS = 30


class DeletionRequestBody(BaseModel):
    note: str | None = Field(None, max_length=2000)


class DeletionRequestStatus(BaseModel):
    reference: str
    status: str
    created_at: datetime
    due_at: datetime
    closed_at: datetime | None = None
    already_open: bool = False


def _deletion_view(
    r: DataSubjectRequestRecord, already_open: bool = False
) -> DeletionRequestStatus:
    return DeletionRequestStatus(
        reference=r.reference,
        status=r.status,
        created_at=r.created_at,
        due_at=r.due_at,
        closed_at=r.closed_at,
        already_open=already_open,
    )


async def _latest_deletion_request(
    session: AsyncSession, user: User
) -> DataSubjectRequestRecord | None:
    return (
        await session.execute(
            select(DataSubjectRequestRecord)
            .where(
                DataSubjectRequestRecord.email == user.email,
                DataSubjectRequestRecord.request_type == DELETION_REQUEST_TYPE,
            )
            .order_by(DataSubjectRequestRecord.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()


@privacy_router.get("/deletion-request", response_model=DeletionRequestStatus | None)
async def my_deletion_request(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> DeletionRequestStatus | None:
    r = await _latest_deletion_request(session, user)
    return _deletion_view(r) if r else None


@privacy_router.post("/deletion-request", response_model=DeletionRequestStatus, status_code=201)
async def request_my_data_deletion(
    body: DeletionRequestBody,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> DeletionRequestStatus:
    existing = await _latest_deletion_request(session, user)
    # admin closes a request as "answered" or "rejected" (kvkk_admin.py)
    if (
        existing is not None
        and existing.closed_at is None
        and existing.status not in ("answered", "rejected")
    ):
        return _deletion_view(existing, already_open=True)

    now = datetime.now(UTC)
    due = add_business_days(now, DELETION_BUSINESS_DAYS)
    ref = str(uuid.uuid7()).replace("-", "")[-8:].upper()
    record = DataSubjectRequestRecord(
        reference=ref,
        full_name=user.name or user.email,
        email=user.email,
        phone=None,
        username=getattr(user, "username", None) or user.email,
        request_type=DELETION_REQUEST_TYPE,
        description=(
            "Kullanıcı uygulama içinden kişisel verilerinin (hesap, içerik, IP/operatör/konum, "
            "cihaz bilgisi, giriş geçmişi, eylem günlükleri ve hata raporları dahil) tüm "
            "sunuculardan silinmesini talep etti."
            + (f"\n\nKullanıcı notu: {body.note}" if body.note else "")
        ),
        extra_info=f"user_id={user.id}",
        identity_method="Uygulama içi (oturum açık hesap)",
        due_at=due,
    )
    session.add(record)
    await session.commit()
    await session.refresh(record)
    logger.info("KVKK silme talebi (uygulama içi) | ref=%s | user=%s", ref, user.id)

    due_str = due.strftime("%d.%m.%Y")
    await send_mail(
        user.email,
        f"Veri silme talebiniz alındı — {ref}",
        f"Merhaba {user.name or ''},\n\nKişisel verilerinizin silinmesi talebiniz alınmıştır.\n"
        f"Referans numaranız: {ref}\n\nVerileriniz en geç 30 iş günü içinde ({due_str}) "
        "tüm sunucularımızdan silinecektir.\n\n— MeetBook",
    )
    controller = get_settings().kvkk_controller_email
    if controller:
        await send_mail(
            controller,
            f"[KVKK] Uygulama içi veri silme talebi {ref}",
            f"Referans: {ref}\nKullanıcı: {user.name} <{user.email}>\nuser_id: {user.id}\n"
            f"Son tarih (30 iş günü): {due_str}\n\nNot:\n{body.note or '-'}",
        )
    return _deletion_view(record)
