# Security & Privacy Specification

> This is the most important document in the project. Every rule states the **attack it
> prevents** — if you're tempted to skip a rule, re-read its attack first.

## 1. Threat Model

| # | Attacker | Attack | Defenses (sections below) |
|---|---|---|---|
| T1 | Stalker | Triangulate a user's home via repeated radius searches | §4 location blurring, §3 rate limits, §7 abuse detection |
| T2 | Predator | Lure a victim to an unsafe meetup spot | §6 meetup safety |
| T3 | Account thief | Credential stuffing / token theft | §2 auth hardening |
| T4 | Scammer | Fake listings, throwaway accounts | §7 trust gates |
| T5 | Data thief | Dump data through API holes | §3 API authz, §5 KVKK minimization |
| T6 | Spammer | Mass requests / chat spam | §3 rate limits, chat scoping |

## 2. Authentication

- **Passwords:** Argon2id (`argon2-cffi`, library defaults are fine). Min length 8, check
  against a breached-password list. *Prevents T3 offline cracking.*
- **Login throttling:** 5 failures / 15 min keyed on `(account, IP)`, exponential backoff,
  generic error "email or password is incorrect" — never reveal account existence. *T3.*
- **Access tokens:** JWT, 15-minute lifetime, contains only `sub` (user id) + `exp` + `jti`.
  No PII in the token — JWTs are readable by anyone who holds them.
- **Refresh tokens:** opaque random 256-bit values, stored **hashed** in DB with a
  `family_id`. Each use issues a new token and revokes the old one. If a revoked token is
  presented again (theft indicator), revoke the **whole family** → forced re-login. *T3.*
- **Mobile storage:** Expo SecureStore only. AsyncStorage is plaintext on disk — never put tokens there.
- **Password reset:** single-use token, 15-min expiry, stored hashed, sent by email.
  Response is identical whether the email exists or not.
- **Phone verification:** SMS OTP (6 digits, 5-min expiry, 3 attempts, resend cooldown
  60 s). Required before the first exchange request. *T4.*

## 3. API Security

- HTTPS only; HSTS at the load balancer.
- **Object-level authorization in every service method.** The single most common real-world
  vulnerability (OWASP API #1). Pattern:

  ```python
  async def get_exchange(self, exchange_id: UUID, current_user: User) -> Exchange:
      exchange = await self.repo.get(exchange_id)
      if exchange is None or current_user.id not in (exchange.requested_by, exchange.requested_to):
          raise NotFoundError()   # 404, not 403 — don't confirm the resource exists
      return exchange
  ```
- **Response schemas:** every endpoint declares `response_model=SomeSchema`. Returning ORM
  objects directly leaks new columns the day someone adds them. *T5.*
- **Rate limits** (Redis sliding window): global 120 req/min/user; login 5/15 min;
  search 30/min; exchange-request create 10/day; messages 60/min; places proxy 60/min;
  OTP send 3/hour. Anonymous endpoints limited by IP.
- **Uploads:** check magic bytes, cap at 10 MB, re-encode with Pillow to JPEG/WebP —
  re-encoding both neutralizes malformed-image exploits **and strips EXIF GPS**. *T1, T5.*
- **State machine:** clients call action endpoints (`/accept`); they never send a `status`
  field. Illegal transitions → 409.
- Standard hardening: parameterized queries only (SQLAlchemy does this — never f-string
  SQL), Pydantic validates all input including lat ∈ [-90, 90] / lng ∈ [-180, 180],
  pagination capped at 50.

## 4. Location Privacy (T1 — the attack this app must never enable)

**Why blurring works:** we snap each book's public coordinate to a ~1 km grid
(geohash precision 6 equivalent) **once at write time and store it** (`public_location`).
Recomputing a random offset per request would let an attacker average many requests to
recover the true point — *static* blurring is the security property, randomness is not.

Rules:
1. The true `location` column never appears in any API response, log, or error message.
   A test asserts this on every search/detail endpoint.
2. Distances shown to other users are rounded to 0.5 km, minimum display "~1 km".
3. Other users' profile/home locations are never returned, full stop.
4. Midpoint computation for meetup suggestions happens server-side; the response contains
   POIs only, not either party's location.
5. Search probing detection: > 20 searches in 10 min with small radius deltas around a
   moving center → flag account to moderation, tighten its rate limit.

## 5. KVKK Compliance (Turkey's GDPR)

- **Consent:** explicit consent screen at registration covering location processing;
  consent recorded with timestamp + policy version.
- **Minimization:** `user_locations` rows hard-deleted after 30 days by a worker. We only
  store fixes taken during active app use, never background tracking.
- **Access/portability:** settings → "Download my data" → async job emails a JSON export.
- **Erasure:** account deletion anonymizes PII in place (name → "Deleted user", email/phone
  nulled, avatar removed, credentials deleted, tokens revoked) while keeping exchange/rating
  skeletons so other users' histories stay coherent.
- **Breach readiness:** structured audit log of security events enables the 72-hour
  notification duty. No PII or tokens in any log line.

## 6. Meetup Safety (T2)

- **Safe categories** (auto-approved when Places API confirms the type): cafe, library,
  book_store, shopping_mall, university, transit_station, restaurant, park (daytime).
- **Manual pins:** reverse-geocode; if residential or unclassified → `validation_status =
  'warning'` and **both** users must tap through "This doesn't look like a public place.
  We recommend meeting at a café or library." before confirmation.
- **Blocklist:** admin-maintained table of banned coordinates/place IDs (checked via
  `ST_DWithin` 100 m).
- **Safety sheet** before every confirmed meetup: meet in public, daylight preferred, tell
  someone, don't share your home address in chat.
- **Trusted contact share:** system share sheet with place, time, and the other user's
  public profile link.
- **Post-meetup check-in:** optional "Did everything go OK?" — a "No" routes to the report flow.

## 7. Trust & Anti-Abuse (T4, T6)

- Phone verification gates exchange requests. New accounts: max 3 active listings,
  3 outgoing requests until first completed exchange.
- Ratings: only after mutual completion; double-blind (revealed when both submit or after
  14 days) to prevent retaliation; one rating per user per exchange (DB unique constraint).
- Blocks: bidirectional invisibility — blocked user's books vanish from your search, chat
  delivery stops instantly (checked in the WebSocket send path, not just the UI).
- Reports: every user/book/message/place has a report action; reports snapshot the content
  (a deleted message must still be moderatable) and land in the admin queue.

## 8. Chat Security

- WebSocket auth: client `POST /api/v1/chat/ticket` (authenticated) → 30-second single-use
  ticket → `wss://…/ws/chat?ticket=…`. Never a JWT in the query string (server/proxy logs
  capture query strings).
- Membership re-checked on connect and per message (an exchange may be cancelled, a block
  may land mid-session).
- Message length cap 2000 chars. Client-side link warning for URLs from non-contacts.

## 9. Infrastructure & Process

- Secrets in environment variables / secret manager — never in the repo. Separate
  dev/staging/prod credentials. Google Places key: server-side only + quota alerts.
- DB user has no SUPERUSER; backups encrypted; Redis password-protected, not internet-exposed.
- CI runs `pip-audit` (deps), `bandit` (static analysis), plus the security test suite
  (see `TESTING_QA_PLAN.md`) on every PR.
- Sentry configured with PII scrubbing on.

## 10. Security Definition of Done (per feature)

- [ ] Every new endpoint has an object-level authorization check **and a test for the cross-user case**
- [ ] No new API response exposes true coordinates or another user's PII
- [ ] New inputs validated by Pydantic with explicit bounds
- [ ] Rate limit considered (and added if the endpoint is abusable)
- [ ] State transitions (if any) go through the state machine
- [ ] No PII/tokens added to logs
