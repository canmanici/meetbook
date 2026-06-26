# TASKMASTER v2 — Frontend / Backend Ayrımı

> Test bittiğinde buraya dön.  
> **Frontend** = backend bağımsız, direkt swarm atılır.  
> **Backend** = API değişikliği gerekli, backend ekibine devret.

---

## 🔵 FRONTEND — Sadece UI, backend değişikliği yok

| # | Ne | Nerede | Süre |
|---|---|---|---|
| F01 | Image cache yönetimi (boyut göster + temizle) | settings/index.tsx | 5dk |
| F02 | "Uygulamayı değerlendir" linki (Store'a yönlendir) | settings/index.tsx | 2dk |
| F03 | Reading stats: bu yıl kaç kitap, km, kişi | profile.tsx | 10dk |
| F04 | Reading goals + streak ("2026'da 24 kitap") | profile.tsx | 12dk |
| F05 | Favoriler listesi ekranı | wishlist/favorites.tsx | 8dk |
| F06 | Wishlist sıralama + öncelik seviyesi | wishlist/index.tsx | 6dk |
| F07 | Fotoğraf kalite skoru (ışık/netlik kuralları) | my-books.tsx | 8dk |
| F08 | Tatil modu (tüm kitapları geçici gizle) | my-books.tsx | 6dk |
| F09 | Hızlı reddetme şablonları ("Şu an müsait değilim") | requests.tsx | 5dk |
| F10 | Genişletilebilir istek önizleme (inline card) | requests.tsx | 12dk |
| F11 | Kayıtlı harita bölgesi (AsyncStorage) | home.tsx | 6dk |
| F12 | "Son görülme" recency indicator (fresh vs stale) | home.tsx | 6dk |
| F13 | Inline preview (kitaba tap → sheet, full nav değil) | home.tsx | 10dk |
| F14 | Yayın sağlığı skoru (fotoğraf/açıklama/kalite) | my-books.tsx | 12dk |
| F15 | Performans insight ("3+ fotoğraf 5x talep") | my-books.tsx | 8dk |
| F16 | Inline preview (tap → sheet, full navigation değil) | home.tsx | 10dk |
| F17 | Hava durumu bilgili buluşma önerisi (weather API) | meetup/select-place.tsx | 8dk |
| F18 | Kalabalık saat verisi (Google Popular Times) | meetup/select-place.tsx | 8dk |
| F19 | Shadow block (engellenen bilmez, mesajlarını görmez) | lib/api/ + chat/ | 8dk |
| F20 | Okuma alışkanlıkları dashboardı (en çok Pazar günü) | profile.tsx | 15dk |
| F21 | Kişilik bazlı kayıt ("seni tanımlayan 3 kitap") | auth/register.tsx | 20dk |

**Toplam: 21 görev — ~3 saat swarm**

---

## 🟠 BACKEND — API değişikliği gerektiren

### Acil (eksik endpoint'ler, v1.1.0 çalışmaz)

| # | Ne | Neden |
|---|---|---|
| B01 | `PATCH /users/me` → `name` alanı ekle | Profil düzenleme çalışmıyor |
| B02 | `DELETE /users/me` → hesap silme | KVKK silme çalışmıyor |
| B03 | `POST /users/me/data-export` | KVKK export çalışmıyor |
| B04 | `POST /auth/password-reset` | Şifre sıfırlama çalışmıyor |
| B05 | `GET /notifications` | Bildirim merkezi çalışmıyor |
| B06 | `POST /users/me/push-token` | Push bildirim çalışmıyor |
| B07 | `MeetupOfferView` → `status`, `proposer_name` alanları ekle | Buluşma geçmişi kırık |
| B08 | `POST /books/bulk-create` | Raf tarama toplu ekleme yapamaz |
| B09 | `GET/POST /saved-searches` | Kayıtlı aramalar sadece local |
| B10 | `POST /users/me/avatar` (resim upload) | Avatar yükleme çalışmıyor |

### Frontend + Backend birlikte

| # | Ne | Frontend | Backend |
|---|---|---|---|
| B11 | Bildirim tercihleri (per-event push ayarı) | settings/index.tsx | `PATCH /users/me/notification-settings` |
| B12 | Oturum geçmişi / aktif cihazlar | settings/index.tsx | `GET /users/me/sessions`, `DELETE /sessions/{id}` |
| B13 | Toplu accept/reject | requests.tsx | `POST /exchanges/batch` |
| B14 | Sohbet sabitleme | chats.tsx | `PATCH /chat/{id}` → `is_pinned` |
| B15 | Sessize alma süresi (1h/8h/1week) | chat/info/[id].tsx | `PATCH /chat/{id}` → `muted_until` |
| B16 | Sohbet geçmişini temizle | chat/info/[id].tsx | `DELETE /chat/{id}/messages` |
| B17 | Akıllı kabul kuralları (auto-accept) | requests.tsx | `POST /users/me/auto-accept-rules` |
| B18 | Rota önizleme (transit süre) | book/[id].tsx | Directions API proxy (zaten var, kontrol et) |
| B19 | Akıllı yeniden listeleme (30 gün sonra öner) | my-books.tsx | `GET /books/stale` backend worker |
| B20 | Kitap emeklilik akışı (alınanı otomatik listele) | exchange/[id].tsx | `POST /exchanges/{id}/retire-book` |
| B21 | Buluşma yeniden planlama | exchange/[id].tsx | `PUT /exchanges/{id}/meetups` |
| B22 | Kitap dostu yerler (partner kafeler) | meetup/select-place.tsx | `GET /places/partners` + admin panel |
| B23 | Ortam keşif push (geofence) | lib/ + home.tsx | Backend worker: check + push |
| B24 | Okuma arkadaşı eşleştirme | exchange/[id].tsx | `POST /exchanges/{id}/reading-buddy` |
| B25 | Kefil sistemi (vouching) | user/[id].tsx | `POST /users/{id}/vouch`, `GET /vouches` |
| B26 | Ortak istek listesi (collaborative wishlist) | wishlist/index.tsx | `POST /wishlists/shared`, `GET /wishlists/shared` |
| B27 | Veri taşınabilirliği (okuma geçmişi export) | settings/index.tsx | `GET /users/me/reading-history/export` |
| B28 | "Canlı" sosyal kanıt (X kişi bakıyor) | home.tsx | WebSocket room + counter |
| B29 | Yıl sonu özeti push | notifications/ | Backend worker: year-end aggregation |
| B30 | "Kitap İkizi" eşleşme bildirimi | notifications/ | Backend worker: compatibility matching |

---

## ÖZET

```
FRONTEND (backend'siz) : 21 görev — ~3 saat — hemen swarm atılır
BACKEND acil           : 10 görev — backend ekibi
BACKEND + FE birlikte  : 20 görev — önce backend, sonra FE swarm
TOPLAM                 : ~51 görev
```

Test bittiğinde **FRONTEND'deki 21 görevi** direkt paralel fırlatırız. Backend ekibine **ACİL 10 endpoint** listesini veririz.
