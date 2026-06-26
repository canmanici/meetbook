# Backend Swarm — BE-01 → BE-06

> **No test runner** — `cd backend && source .venv/bin/activate && python -m pytest` (if needed)
> **No git** — controller commits centrally
> **Max parallelism** — zero file conflicts per wave

---

## BE-01: Auth Improvements (B01+B02+B10)

**Files touched:** `auth/schemas.py`, `auth/router.py`, `auth/service.py`

### B01 — `name` alanı UpdateMe'de
- `auth/schemas.py`: `UpdateMeRequest` → `name: str | None = Field(default=None, min_length=1, max_length=100)` ekle
- `auth/service.py`: `update_me()` → `"name" in sent` kontrolü ekle, `user.name = body.name` yaz

### B02 — `DELETE /auth/me` (hesap silme)
- `auth/schemas.py`: `DeleteAccountRequest(BaseModel)` → `password: str`
- `auth/service.py`: `delete_account(user_id, password)` metodu:
  1. Şifreyi doğrula
  2. `user.status = UserStatus.deleted`
  3. Tüm refresh token'ları revoke et
  4. Email'i hash'le (anonymize): `user.email = f"deleted-{user.id}@anon"`
  5. `user.name = "Silinmiş Hesap"`
  6. `user.phone = None`
  7. `user.updated_at = now`
  8. Audit log: `"account_deleted"`
- `auth/router.py`: `DELETE /me` endpoint, body `DeleteAccountRequest`

### B10 — Avatar yükleme
- `auth/schemas.py`: `MeResponse` → `avatar_url: str | None = None` ekle
- `User` model'ine `avatar_url` kolonu ekle (new migration)
- `auth/router.py`: `POST /me/avatar` endpoint → `UploadFile`, S3'e yükle, `user.avatar_url`'e kaydet
- `auth/service.py`: `upload_avatar(user_id, file_bytes, content_type)` metodu
- **Yeni migration:** `backend/alembic/versions/` → `add_avatar_url_to_users.py`
- `auth/service.py` `get_me()`'de `avatar_url`'i response'a ekle

---

## BE-02: Bulk Book Creation (B08)

**Files touched:** `books/router.py`, `books/service.py`, `books/schemas.py`

- `books/schemas.py`: `BookBulkCreateRequest(BaseModel)` → `books: list[BookCreateRequest]`
- `books/schemas.py`: `BookBulkCreateResponse(BaseModel)` → `items: list[BookOwnerView], failed: list[FailedBookCreate]`
- `books/schemas.py`: `FailedBookCreate(BaseModel)` → `index: int, error: str`
- `books/router.py`: `POST /books/bulk` endpoint
- `books/service.py`: `bulk_create(owner_id, body)` →
  1. Her kitap için create logic'i (validate location, blur, etc.)
  2. Hata olanları `failed` listesine ekle, başarılı olanları `items`
  3. Tek transaction — başarısız olanları ata, iyi olanları commit et

---

## BE-03: Saved Searches API (B09)

**Yeni module:** `backend/app/modules/saved_searches/`

### Dosyalar:
- `saved_searches/__init__.py` — boş
- `saved_searches/models.py` — SavedSearch model:
  ```python
  class SavedSearch(Base):
      id = Column(UUID, primary_key, default=uuid4)
      user_id = Column(UUID, ForeignKey("users.id"), nullable=False)
      params = Column(JSONB, nullable=False)  # { category, radius_km, lat, lng, q }
      name = Column(String(100), nullable=True)
      created_at = Column(DateTime)
      updated_at = Column(DateTime)
  ```
- `saved_searches/schemas.py`: `SavedSearchCreate, SavedSearchView, SavedSearchList, SavedSearchUpdate`
- `saved_searches/repository.py`: CRUD
- `saved_searches/service.py`: CRUD logic
- `saved_searches/router.py`: `GET /saved-searches`, `POST /saved-searches`, `GET /saved-searches/{id}`, `PUT /saved-searches/{id}`, `DELETE /saved-searches/{id}`
- `routers.py`: register `saved_searches.router`
- **Yeni migration:** `add_saved_searches_table.py`

### Frontend sonra AsyncStorage → API çağrısına çevirir (bu swarming kapsamı dışı)

---

## BE-04: Password Reset Frontend Wiring (B04)

**Files touched:** `mobile/src/app/auth/forgot-password.tsx`

Backend'de `POST /auth/password-reset-request` ve `POST /auth/password-reset-confirm` zaten var. Frontend hiç çağırmıyor.

- `forgot-password.tsx`: `onSubmit`'e API çağrısı ekle:
  ```typescript
  await apiClient.post('/auth/password-reset-request', { email });
  ```
- Yeni ekran: `auth/reset-password.tsx` — token + new password formu
  - `POST /auth/password-reset-confirm` çağır
  - Başarılı → login sayfasına yönlendir
- `app/auth/_layout.tsx`'e reset-password route'u ekle

---

## BE-05: Saved Searches Frontend (B09 frontend)

**Files touched:** `mobile/src/app/saved-searches/index.tsx`

AsyncStorage → API çağrılarına çevir:
- `GET /api/v1/saved-searches` → list
- `POST /api/v1/saved-searches` → create
- `PUT /api/v1/saved-searches/{id}` → update
- `DELETE /api/v1/saved-searches/{id}` → delete
- AsyncStorage yedek olarak kalsın (offline destek)

---

## ÖZET SWARM PLANI

```
WAVE 1 (3 paralel, 0 çakışma):
  ├── BE-01: Auth (B01+B02+B10)      → auth/schemas, router, service + migration
  ├── BE-02: Bulk books (B08)         → books/schemas, router, service
  └── BE-03: Saved searches (B09)     → yeni module (models, schemas, repo, service, router)

WAVE 2 (1 agent, WAVE 1 sonrası):
  └── BE-04: Password reset frontend  → forgot-password.tsx + yeni reset-password.tsx

WAVE 3 (1 agent, BE-03 sonrası):
  └── BE-05: Saved searches frontend  → saved-searches/index.tsx AsyncStorage → API
```
