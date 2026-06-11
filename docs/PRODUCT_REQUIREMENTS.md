# Product Requirements

> Read `../Meetbook.md` first. This document details WHAT we build and for WHOM.

## Vision

People in Turkey exchange physical books with nearby strangers, safely. The book is the
icebreaker; the product's real job is making a stranger-to-stranger physical meetup
feel safe, simple, and pleasant.

## Personas

- **Ayşe, 28, Kadıköy** — reads 2–3 books/month, shelves overflowing. Wants to pass books
  on, but won't meet a stranger unless the app clearly signals safety. Primary persona.
- **Mehmet, 35, Ankara** — bargain hunter, wants specific titles. Power user of search,
  wishlist, and ISBN scan.
- **Zeynep, 19, student** — low budget, exchanges textbooks. Mobile-only, expects
  Instagram-level polish, abandons clunky apps instantly.

## User Roles

| Role | Can do |
|---|---|
| Guest | Browse the app store listing only. The app requires an account (location data demands accountability). |
| Registered user | Browse/search books, manage profile. **Cannot** create exchange requests until phone-verified. |
| Verified user | Everything: list books, request exchanges, chat, meet, rate. |
| Moderator/Admin | Web dashboard: handle reports, suspend users, take down listings, blocklist meetup places. |

## Functional Requirements

### Accounts
- Email + password registration with KVKK consent screen.
- Login, logout, password reset, token refresh (invisible to the user).
- Phone verification via SMS OTP — gate for exchange requests.
- Profile: name, avatar, bio, city, badges, stats (completed exchanges, response rate).
- Data export and account deletion in settings (KVKK rights).

### Books
- Create listing: title, author, ISBN, description, category, language, condition (enum:
  new / like-new / good / worn), 1–5 photos.
- ISBN barcode scan autofills title/author/cover from Open Library / Google Books.
- Edit, deactivate, delete listings. Availability toggles automatically during an active exchange.
- Owner sets the book's location once (defaults to profile city center); only a blurred
  version is ever shown to others.

### Discovery
- Nearby search: radius slider (1–50 km), filters (category, language, condition), sort by distance/recency.
- Map view with blurred pins; list view with rounded distances ("~3 km").
- Wishlist: title/ISBN watch → push notification when a match appears within the user's radius.
- Favorites. Swap suggestions ("you both want each other's books").

### Exchange lifecycle
- Request with message → accept / reject / cancel. No self-requests, no duplicate active
  requests for the same book by the same user.
- Statuses (server-controlled): pending, accepted, rejected, cancelled, meetup_proposed,
  meetup_confirmed, completion_pending, completed, expired.
- 14-day auto-expiry for stale requests.

### Meetup
- Place picker: full-screen map, draggable pin, place autocomplete (Turkey), suggested
  safe POIs near the midpoint of both users.
- Proposal includes place **and time** (`scheduled_at`). Other party accepts/rejects;
  reschedule supported.
- Validation: point inside Turkey; public POI preferred; manual residential pin → double-acknowledged warning.
- Reminders: push 24 h and 1 h before. "Open in maps" chooser (Google → Yandex → Apple →
  copy address). "Share with trusted contact" share sheet.

### Chat
- One chat per accepted exchange. Realtime via WebSocket; history via REST.
- Read receipts, unread counts, push on new message. Report message, block user.

### Trust
- Double-blind ratings (1–5 + comment) unlock after mutual completion confirmation;
  revealed when both submitted or after 14 days.
- Report user/book/message/place with reason. Block hides all of a user's content and
  silences chat immediately.
- New-account limits: max 3 active listings and 3 outgoing requests until first completed exchange.

### Notifications
- Push + in-app center: request received/accepted, meetup proposed/confirmed, reminders,
  new message, wishlist match, moderation outcomes.

## Non-Functional Requirements

- Turkish + English UI, Turkish default. All user-facing strings via i18n from day one.
- Search p95 < 500 ms at 100k books (PostGIS GiST indexes make this realistic).
- WCAG AA contrast; 44 pt touch targets.
- KVKK compliance (see `SECURITY_AND_PRIVACY.md`).
- Offline tolerance: cached lists render without network; mutations queue or fail gracefully.

## Explicitly Out of Scope (v1)

- Selling books / payments. Shipping/cargo exchange. Multi-book bundles in one request.
  In-app voice/video. Social feed. iPad/web client (admin dashboard excepted).
