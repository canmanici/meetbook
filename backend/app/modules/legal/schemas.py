"""Pydantic schemas for legal endpoints."""


from pydantic import BaseModel, Field, EmailStr


class CurrentPolicyResponse(BaseModel):
    """Response for current KVKK policy version check."""

    current_version: str = Field(..., description="Current active policy version")
    user_accepted_version: str | None = Field(None, description="Version the user accepted")
    accepted: bool = Field(..., description="Whether user has accepted the current version")
    privacy_policy_url: str = Field("/legal/gizlilik-politikasi", description="URL to full privacy policy")
    disclosure_url: str = Field("/legal/kvkk-aydinlatma-metni", description="URL to KVKK disclosure text")


class AcceptPolicyRequest(BaseModel):
    """Request body for accepting a new policy version."""

    version: str = Field(..., min_length=3, max_length=20, description="Policy version to accept")


class AcceptPolicyResponse(BaseModel):
    """Response after accepting a policy version."""

    success: bool = Field(..., description="Whether acceptance was successful")
    accepted_version: str = Field(..., description="The version that was accepted")
    message: str = Field("Politika başarıyla onaylandı.", description="Human-readable message")


class DataSubjectRequest(BaseModel):
    """KVKK veri sahibi başvuru formu."""

    adsoyad: str = Field(..., min_length=1, max_length=200)
    eposta: EmailStr
    telefon: str | None = Field(None, max_length=20)
    kullaniciadi: str = Field(..., min_length=1, max_length=100)
    basvuruTuru: str = Field(..., description="Başvuru türü kodu")
    talepAciklama: str = Field(..., min_length=10, max_length=10000)
    ekBilgi: str | None = Field(None, max_length=5000)
    kimlikDogrulama: str = Field(..., description="Kimlik doğrulama yöntemi")


class DataSubjectResponse(BaseModel):
    """Response after submitting a data subject request."""

    success: bool = True
    message: str = "Başvurunuz başarıyla alınmıştır. En geç 30 gün içinde yanıtlanacaktır."
    reference_number: str | None = None
