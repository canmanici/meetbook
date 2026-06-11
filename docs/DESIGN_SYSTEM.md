# Design System & Screen Specs

> Build the system first (Phase 2), then compose screens from it. If you're styling a
> screen with raw values, stop — add or use a token/component instead.

## 1. Foundations (tokens — `mobile/components/ui/tokens.ts`)

- **Spacing:** 4-pt grid → `4, 8, 12, 16, 24, 32, 48`.
- **Type scale:** 12 (caption) / 14 (body-sm) / 16 (body) / 20 (title) / 24 (heading) /
  32 (display). Font: Inter (UI) + a serif accent (Lora) for book titles only — the
  literary touch.
- **Radius:** 8 (inputs, cards), 16 (sheets, modals), 999 (pills, avatars).
- **Color:** warm, literary, trustworthy.
  - Primary: deep teal `#0F6E5D` (trust) — light bg `#F7F5F0` (paper warmth).
  - Accent: amber `#D97706` (used sparingly: badges, highlights).
  - Semantic: success `#15803D`, warning `#B45309`, danger `#B91C1C`, info `#1D4ED8`.
  - Dark palette mirrors with adjusted lightness; both palettes WCAG AA against their text colors.
- **Elevation:** subtle — 1 shadow level for cards, 1 for sheets. No glassmorphism on lists (perf).

## 2. Core Components (build these before any screen)

| Component | Variants / notes |
|---|---|
| Button | primary / secondary / ghost / danger; loading + disabled states built in |
| Input | label, helper, error, password reveal; phone input with TR mask |
| Card | BookCard (cover, title serif, author, condition Badge, "~3 km" distance) |
| Avatar | with verification badge slot |
| Badge | condition, verification, status colors from semantic palette |
| Sheet | bottom sheet for pickers/actions (place details, report, map provider chooser) |
| MapPin | blurred-area pin (circle, not point) vs. exact meetup pin (distinct shapes — privacy made visible) |
| EmptyState | illustration + one-line copy + CTA button; every list uses one |
| Skeleton | list-item and card shapes; all lists load with skeletons, never spinners |
| Timeline | the exchange lifecycle component (see Exchange screen) |
| Toast / InlineError | human copy: "Couldn't reach the server — pull to retry" |

A hidden dev route `/__gallery` renders every component in every state — this is Phase 2's
Definition of Done and the designer/dev review surface.

## 3. Screen Specs (each screen has ONE job)

**Home (tab)** — *"books near me."* List/map toggle top-right. Radius + filter chips.
BookCards with rounded distance. Empty state: "No books nearby yet — widen your radius or
add the first one." Map mode: clustered blurred pins → bottom-sheet card on tap.

**Search (tab)** — query + filters; results identical to Home list. Wishlist entry point
("Can't find it? Add to wishlist — we'll notify you.").

**Book detail** — *build enough trust to request.* Cover gallery, serif title, condition,
description; owner block (avatar, badges, rating, completed-exchange count, response
rate); "~3 km away" — never an address or map of the book. Primary CTA: Request Exchange
(message composer sheet). Overflow: report, favorite.

**Requests (tab)** — segmented Sent / Received; status Badge per row; tap → Exchange detail.

**Exchange detail** — *the single timeline.* One vertical Timeline showing: request sent →
accepted → chat (inline last messages, "open chat") → meetup proposed (place card + time
+ accept/reject/reschedule) → confirmed (countdown, "open in maps", "share with trusted
contact", safety sheet link) → completion (mark/confirm buttons) → rating prompt. Users
never hunt across tabs to find the next action — the next action is always the highlighted
node on this timeline.

**Meetup picker** — full-screen map; draggable pin + tap-to-place; search bar (autocomplete
sheet); "suggested safe places" chips row (the 3–5 midpoint POIs); under the pin: place
label + inline validation chip (green "Public place ✓" / amber warning / red "Outside
Turkey"); date-time picker; CTA "Propose this place".

**Chats (tab)** — conversation list with unread counts; chat screen with book context
header (cover thumbnail + status), read receipts, report/block in overflow.

**Profile (tab)** — own profile, stats, badges; my books grid; settings (theme, language,
notifications, privacy: export data / delete account).

**Auth flow** — welcome (value prop + safety promise), signup with KVKK consent checkbox
(linked full text), login, forgot password, phone verification (OTP boxes) presented when
first needed, with a "why we ask" line.

## 4. Interaction & Motion

- Navigation transitions: default Expo Router; no custom heroics in v1.
- Micro-interactions only where they communicate state: button press scale 0.97, heart
  pop on favorite, timeline node check-in animation. Keep under 200 ms, `react-native-reanimated`.
- Pull-to-refresh on all lists; optimistic UI for favorite/read-receipts; never optimistic
  for exchange state changes (server is the state machine).

## 5. Content & Tone

- Turkish first; warm and direct ("Kitabı iste" not "Talep oluştur"). No corporate jargon.
- Safety copy is calm, not scary: "Halka açık bir yerde buluşmanızı öneririz."
- Errors say what to do next. Empty states invite an action.

## 6. Accessibility Checklist (per screen PR)

- [ ] Touch targets ≥ 44 pt   [ ] `accessibilityLabel` on every interactive element
- [ ] AA contrast in both themes   [ ] Works at 130% font scale
- [ ] Map flows have a non-map alternative (list of suggested places)
