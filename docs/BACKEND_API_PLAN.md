# Backend API Plan

> Base path `/api/v1`. Auth = `Authorization: Bearer <access JWT>` unless marked public.
> Errors: `{ "error": { "code": "...", "message": "..." } }`. Unknown/foreign resources → 404.
> List endpoints: `?cursor=&limit=` (limit ≤ 50). Rate limits per `SECURITY_AND_PRIVACY.md` §3.

## Auth — `/auth`

| Method & path | Auth | Notes |
|---|---|---|
| POST `/register` | public | email, password, full_name, kvkk_consent: true. Returns user + token pair. Generic response on duplicate email. |
| POST `/login` | public | Returns `{access_token, refresh_token, user}`. Throttled 5/15min. |
| POST `/refresh` | public | Body: refresh_token. Rotates; replay of revoked token → revoke family + 401. |
| POST `/logout` | ✓ | Revokes the presented refresh token family. |
| POST `/verify-phone/request` | ✓ | Sends OTP. 3/hour. |
| POST `/verify-phone/confirm` | ✓ | code → sets `phone_verified_at`. 3 attempts per OTP. |
| POST `/password-reset/request` | public | Always 204 (no account-existence leak). |
| POST `/password-reset/confirm` | public | token + new password; revokes all refresh tokens. |

## Users — `/users`

| Method & path | Auth | Notes |
|---|---|---|
| GET `/me` | ✓ | Full own profile incl. verification states. |
| PATCH `/me` | ✓ | name, bio, city, avatar. |
| POST `/me/avatar` | ✓ | Returns presigned upload URL; confirm endpoint re-encodes & strips EXIF. |
| GET `/{id}` | ✓ | **Public** profile only: name, avatar, bio, city, badges, rating, stats. Never location/email/phone. 404 if blocked either way. |
| GET/POST/DELETE `/me/blocks` | ✓ | List, block, unblock. |
| GET `/me/export` | ✓ | KVKK data export (async job → email). |
| DELETE `/me` | ✓ | KVKK erasure: anonymize PII, revoke tokens. Password re-entry required. |

## Books — `/books`

| Method & path | Auth | Notes |
|---|---|---|
| POST `/` | verified | Creates listing; server computes `public_location` blur. |
| GET `/search` | ✓ | `lat,lng,radius_km,category,language,condition,q,cursor`. Response: blurred coords + 0.5km-rounded distance. **Never true coords.** 30/min. |
| GET `/{id}` | ✓ | Detail + owner public profile + blurred location. Owner sees own true location. |
| PATCH `/{id}` / DELETE `/{id}` | owner | Soft delete. Delete blocked while exchange active. |
| POST `/{id}/photos` | owner | Presigned upload → confirm → re-encode + EXIF strip. Max 5. |
| GET `/isbn/{code}` | ✓ | Proxied Open Library/Google Books lookup, cached in Redis 30d. |
| GET/POST/DELETE `/me/wishlist`, `/me/favorites` | ✓ | Wishlist match → push notification (worker). |

## Exchanges — `/exchanges`

| Method & path | Auth | Notes |
|---|---|---|
| POST `/` | verified | book_id + message. Rejects: own book, duplicate active, blocked pair, unavailable book, new-account limit exceeded. |
| GET `/?role=sent|received&status=` | ✓ | Own exchanges only. |
| GET `/{id}` | participant | Full detail: book, counterpart public profile, meetup, status history. |
| POST `/{id}/accept` `/reject` `/cancel` | participant | State machine enforced; wrong actor or transition → 409. Accept creates the chat. |
| POST `/{id}/complete` | participant | Sets `completion_pending`, records `completion_marked_by`. |
| POST `/{id}/confirm-completion` | other participant | → `completed`; book unavailable; ratings unlock; counters update. |

## Meetup — `/exchanges/{id}/meetup`

| Method & path | Auth | Notes |
|---|---|---|
| GET `/suggestions` | participant | Server computes midpoint of both users' recent locations → 3–5 safe POIs. Response contains POIs only. |
| POST `/` | participant | place (from `/places` or manual pin) + `scheduled_at`. Server validates: in-Turkey polygon, blocked-places radius, POI category → `validation_status`. Residential pin requires `acknowledge_warning: true`. |
| POST `/accept` | other participant | → `meetup_confirmed`; schedules reminders. Warning-status places require acknowledgment too. |
| POST `/reject` | other participant | Back to `accepted`; new proposal allowed. |
| POST `/reschedule` | participant | New proposal superseding old; notifies counterpart. |

## Places — `/places` (Google Places proxy; key never leaves the server)

| Method & path | Notes |
|---|---|
| GET `/autocomplete?q=&lat=&lng=` | Turkey-bounded; Redis cache 24h; 60/min. |
| GET `/{place_id}` | Details + our safety category mapping. Cache 7d. |
| GET `/nearby?lat=&lng=&category=` | Safe-category POIs near a point. Cache 6h on rounded coords. |

## Chat

| Method & path | Auth | Notes |
|---|---|---|
| POST `/chat/ticket` | ✓ | 30s single-use WS ticket. |
| WS `/ws/chat?ticket=` | ticket | Events: `send`, `message`, `read`, `error`. Membership + block checked per message. |
| GET `/exchanges/{id}/chat/messages` | participant | Paginated history. |
| POST `/exchanges/{id}/chat/read` | participant | Mark read up to message id. |

## Ratings, Reports, Notifications

| Method & path | Auth | Notes |
|---|---|---|
| POST `/ratings` | participant | Only when exchange `completed`; unique per user+exchange; double-blind reveal. |
| GET `/users/{id}/ratings` | ✓ | Revealed ratings only. |
| POST `/reports` | ✓ | target_type+target_id+reason; server snapshots content. |
| GET `/notifications`, POST `/notifications/read` | ✓ | In-app center. |
| POST `/devices` | ✓ | Register Expo push token. |

## Admin — `/admin/*` (role-gated, separate rate limits, audit-logged)

Reports queue (list/claim/resolve), user suspension/reinstatement, listing takedown,
blocked-places CRUD, basic metrics (DAU, exchanges by status, reports by reason).

## Implementation Notes

- FastAPI dependency chain: `get_current_user` → `get_verified_user` → per-resource
  participant/ownership checks **inside services** (not in routers).
- OpenAPI generated at `/openapi.json`; mobile types generated from it in CI.
