# 🐛 Meetbook Bug Tracker

> **Audit Date:** 25 Haziran 2026  
> **Total Issues Found:** 52 (15 Critical, 17 High, 14 Medium, 6 Low)  
> **Fixed in 3 Waves:** 29 bugs fixed  
> **Remaining:** 23 (0 Critical, 0 High, 14 Medium, 6 Low + 3 already fixed in Wave 2)

---

## ✅ ALREADY FIXED (Wave 1 + 2 + 3 — 29 bugs)

### Wave 1a — İlk Müdahale (4 bug)
| # | Bug | Dosya | Ne Yapıldı |
|---|-----|-------|-----------|
| C1 | Password reset token stdout | `backend/app/modules/auth/service.py:213` | `print()` satırı silindi |
| C2 | Chat star/pin yetki kontrolü yok | `backend/app/modules/chat/router.py:98-121` | `is_participant` kontrolü eklendi, 403 dönüyor |
| C11 | API client şifre logluyor | `mobile/src/lib/api/client.ts:88` | `if (__DEV__)` guard'ı eklendi |
| C12 | MapTiler API key source'da | `mobile/src/lib/map-adapter.tsx:18` | `EXPO_PUBLIC_MAPTILER_KEY` env var'ına taşındı ⚠️ key'i rotate et |

### Wave 1b — Parallel Agent Wave 1 (11 bug)
| # | Bug | Dosya | Ne Yapıldı |
|---|-----|-------|-----------|
| C3 | audit.py tüm session'ı commit ediyor | `backend/app/core/audit.py:32-33` | `commit()` → `flush()`, caller commit yapsın |
| C5 | Ban'lanan user refresh ile aktif kalır | `backend/app/modules/auth/service.py:177` | `user.status != UserStatus.active` kontrolü eklendi |
| C9 | reset_engine() pool leak | `backend/app/core/db.py:50-63` | `async def` + `await _engine.dispose()` eklendi |
| C10 | Geofence model env.py'de yok | `backend/alembic/env.py:11-19` | `from app.modules.geofence import models` eklendi |
| C14 | Docker root çalışıyor | `backend/Dockerfile` | `useradd appuser` + `USER appuser` eklendi |
| C13 | Book edit refetch form'u eziyor | `mobile/src/app/book/[id].tsx:134-146` | `useRef` guard ile sadece edit moduna ilk girince doldur |
| H3 | Rating IntegrityError rollback | `backend/app/modules/ratings/service.py:69-71` | try/except kaldırıldı, pre-check zaten var |
| H4 | Health endpoint her çağrıda Redis | `backend/app/main.py:164-168` | `get_redis()` singleton kullanıldı |
| H5 | Exchange fotoğraf boyut limiti yok | `backend/app/modules/exchanges/router.py:177` | 10MB limit eklendi (HTTP 413) |
| H7 | WebSocket hataları sessizce yutuluyor | `backend/app/modules/chat/router.py:277-278` | `logger.exception(...)` eklendi |
| H12 | Book new title validasyonu yok | `mobile/src/app/book/new.tsx:160` | `if (!title.trim())` submit kontrolü eklendi |

### Wave 2 — Parallel Agent Wave 2 (10 bug)
| # | Bug | Dosya | Ne Yapıldı |
|---|-----|-------|-----------|
| C4 | Login throttle proxy IP | `backend/app/modules/auth/router.py:60` | `_get_client_ip()` helper ile `X-Forwarded-For` desteği |
| C6 | Counter race condition (books) | `backend/app/modules/books/repository.py:638,664,685` | `func.coalesce()` ile server-side atomic increment |
| C7 | N+1 chat listesi | `backend/app/modules/chat/repository.py:76-163` | Correlated subquery'ler ile tek sorguya indirildi |
| C8 | N+1 search_clusters redundant fetch | `backend/app/modules/books/repository.py:575-577` | JOIN'den gelen owner bilgisi kullanıldı, redundant query silindi |
| H1 | Exchange counter race | `backend/app/modules/exchanges/service.py` | 7 adet Python-side increment `update().values()` ile atomik yapıldı |
| H2 | TOCTOU loan race | `backend/app/modules/exchanges/service.py:222-231` | `SELECT ... FOR UPDATE` ile row lock eklendi |
| H6 | Worker batch commit yok | `backend/app/workers/geofence_matcher.py`, `reveal_ratings.py` | Per-item try/except + 50'şerli batch commit + logging |
| H8 | Token refresh race (sessiz logout) | `mobile/src/lib/api/client.ts:145-154` | `refreshPromise` mutex ile concurrent refresh'ler sıraya alındı |
| H10 | Chat sendMessage sessizce düşer | `mobile/src/stores/chat-store.ts` + `api/chat.ts` | Optimistic mesaj ekleme + send failure rollback |
| H13 | Home hata durumunda boş harita | `mobile/src/app/tabs/home.tsx` | Error overlay + retry butonu eklendi |
| H15+H16+H17 | Docker compose güvenlik | `docker-compose.yml` + `docker-compose.prod.yml` | Resource limits, MinIO IP whitelist, backend healthcheck |

### Wave 3 — Final Wave (4 bug)
| # | Bug | Dosya | Ne Yapıldı |
|---|-----|-------|-----------|
| C15 | Dev credential'lar git'te | `docker-compose.yml`, `alembic.ini`, `backfill_book_covers.py` | Hardcoded değerler `${VAR:-default}` env var pattern'ine taşındı |
| H9 | Web localStorage token XSS | `mobile/src/lib/secure-store.web.ts` | `localStorage` → `sessionStorage` (sekme kapanınca silinir) |
| H11 | Favorites AsyncStorage plain text | `mobile/src/stores/favorites.ts`, `secure-store.ts` | SecureStore adapter yazıldı, AsyncStorage kullanımı kaldırıldı |
| H14 | user/[id] verimsiz query | backend `books/repository.py`, `router.py`, `service.py`, `schemas.py` + mobile `client.ts`, `user/[id].tsx` | `owner_id` filtresi eklendi, `radius_km: 99999` kullanımı kaldırıldı |

---

## ☠️ REMAINING CRITICAL (0 adet — Tamamı düzeltildi ✅)

---

### C15 — Dev Credential'lar Git'te
| Alan | Detay |
|------|-------|
| **Dosya** | `docker-compose.yml`, `backend/alembic.ini`, `.github/workflows/ci.yml`, `backend/scripts/backfill_book_covers.py` |
| **Ciddiyet** | ☠️ Critical |
| **Ne oluyor** | `meetbook:meetbook_dev` (Postgres şifresi), `meetbook_minio_dev` (MinIO şifresi) gibi credential'lar git history'de commit'lenmiş durumda. `.env` dosyaları `.gitignore`'da ama bu credential'lar config dosyalarının içinde. |
| **Neden kötü** | Repo public olursa veya leak olursa tüm geliştirme ortamına erişim sağlanır. Production'da farklı credential'lar kullanılıyor (iyi), ama dev ortamı açıkta. |
| **Nasıl düzeltilir** | Production'da zaten env var'dan geliyor (doğru). Dev için: 1) `docker-compose.yml`'daki hardcoded şifreleri `${POSTGRES_PASSWORD:-meetbook_dev}` gibi default'lu env var yap, 2) `alembic.ini`'deki URL'i env var'dan oku, 3) `backfill_book_covers.py`'deki key'leri env var'dan oku. Git history temizliği için `git-filter-repo` veya `BFG Repo-Cleaner`. |
| **Değişecek kod** | Birden fazla dosya. En kritik: `docker-compose.yml`'da `${VAR:-default}` pattern'ine geç. |

---

## 🟠 REMAINING HIGH (0 adet — Tamamı düzeltildi ✅)

---

## 🟡 MEDIUM (13 adet — Backlog)

| # | Dosya | Sorun | Fix |
|---|-------|-------|-----|
| M1 | `backend/app/modules/books/repository.py` | **Eksik index:** isbn, language, condition kolonlarında index yok | `CREATE INDEX ON books (isbn) WHERE deleted_at IS NULL` |
| M2 | `backend/app/modules/auth/repository.py` | **Eksik index:** refresh_tokens.user_id, password_reset_tokens.user_id yok | `CREATE INDEX ON refresh_tokens (user_id)` vb. |
| M3 | `backend/app/modules/wishlist/models.py:12-25` | **Duplicate wishlist:** UNIQUE(user_id, isbn) yok | Migration ile UNIQUE constraint ekle |
| M4 | `backend/alembic/versions/331adac8bfab:25` | **Email case-sensitive:** citext kullanılmamış | `ALTER TABLE users ALTER COLUMN email TYPE CITEXT` |
| M5 | `backend/app/modules/auth/models.py:57-58` | **Rating denormalizasyonu trigger'sız** | Rating değişiminde aggregate güncelle |
| M6 | `mobile/src/app/meetup/select-place.tsx:90-108` | **Autocomplete race:** geç response öncekini ezer | AbortController veya request counter |
| M7 | `mobile/src/app/tabs/home.tsx:543-567` | **Tüm marker'lar re-render** | `isSelected` boolean prop kullan |
| M8 | `mobile/src/app/chat/[id].tsx:373-374` | **Input ref çakışması** | Ayrı ref'ler kullan |
| M9 | `mobile/src/app/wishlist/index.tsx:26-27` | **Unused state:** title, author | Input ekle veya state sil |
| M10 | `mobile/src/lib/api/client.ts:92` | **Fetch timeout yok** | AbortController ile 30s timeout |
| M11 | `mobile/src/stores/chat-store.ts:77-87` | **Mesajlar sıralı değil** | `sort(created_at)` ekle |
| M12 | `backend/app/workers/geofence_matcher.py`, `reveal_ratings.py` | **H6: Batch commit yok** ✅ Fixed in Wave 2 | **(zaten düzeltildi)** |
| M13 | `backend/alembic/versions/*.py` | **Migration docstring mismatch** | Revision ID'leri düzelt |
| M14 | `mobile/src/lib/map-adapter.tsx:111` | **Unused cameraRef** | Kullan veya sil |

> **Not:** M12, H6 ile zaten fixlendiği için listede kaldı ama ✅.

---

## 🔵 LOW (6 adet — Fırsat Bulunca)

| # | Dosya | Sorun | Fix |
|---|-------|-------|-----|
| L1 | `mobile/src/lib/format.ts:3-11` | **Duplicate category labels** | `constants/books.ts`'den import et |
| L2 | `mobile/src/lib/query-client.ts:3` | **Bare QueryClient** | `staleTime: 30_000`, `gcTime: 5min`, `retry: 2` |
| L3 | `mobile/src/lib/map-adapter.tsx:121` | **Hardcoded Istanbul fallback** | Device locale tahmini |
| L4 | `backend/alembic.ini:4` | **DB şifresi git'te** | Env var'dan oku |
| L5 | `.github/workflows/ci.yml` | **CI Redis auth yok** | Redis password set et |
| L6 | `.pre-commit-config.yaml` | **Secret scanner yok** | `gitleaks` hook'u ekle |

---

## 📊 Güncel İstatistik

| Severity | Toplam | Fixed | ✅ | Kalan |
|----------|--------|-------|---|-------|
| ☠️ Critical | 15 | 15 | ✅ | **0** |
| 🟠 High | 17 | 17 | ✅ | **0** |
| 🟡 Medium | 14 | 1 | ✅ | **13** |
| 🔵 Low | 6 | 0 | | **6** |
| **Toplam** | **52** | **33** | | **19** |

---

## 🔧 Sonraki Adımlar

✅ **Tüm Critical ve High bug'lar düzeltildi!** (29/52)

Kalan Medium (13) + Low (6) = 19 bug sprint backlog'unda değerlendirilebilir.
