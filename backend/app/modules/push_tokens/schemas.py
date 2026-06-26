from pydantic import BaseModel, Field


class PushTokenRegisterRequest(BaseModel):
    token: str = Field(..., min_length=1, max_length=255)
    platform: str = Field(..., pattern="^(android|ios)$")
    device_id: str | None = Field(None, max_length=100)


class PushTokenResponse(BaseModel):
    ok: bool = True
