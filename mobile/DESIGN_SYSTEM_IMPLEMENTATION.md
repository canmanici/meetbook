# Design System Implementation

This document describes the implemented design system and app shell for the
Meetbook mobile app (Phase 2).

## Component Status

✅ **Completed Components** (`mobile/src/components/ui/`):

- **Button** — primary, secondary, ghost, danger variants; loading & disabled states (`button.tsx`)
- **Input** — label, helper/error text, password visibility toggle (`input.tsx`)
- **Card & BookCard** — generic surface container and a book listing card with cover image error fallback and condition badge (`card.tsx`)
- **Avatar** — initials fallback, image, verification badge, small/medium/large sizes (`avatar.tsx`)
- **Badge** — semantic color variants (success, warning, danger, info, primary) (`badge.tsx`)
- **Sheet** — bottom sheet modal with header, title, close button (`sheet.tsx`)
- **EmptyState** — illustration + message + optional description and action button (`emptystate.tsx`)
- **Skeleton** — `card` and `list-item` loading placeholders (`skeleton.tsx`)
- **Toast & InlineError** — floating toast notifications and inline error banners (`toast.tsx`)

All components are exported from the barrel file `mobile/src/components/ui/index.ts`,
along with their associated types (`ButtonVariant`, `BookCondition`, `AvatarSize`,
`BadgeVariant`, `EmptyStateProps`, `SkeletonProps`/`SkeletonVariant`, `ToastVariant`)
and the full token set (`export * from './tokens'`).

## App Shell Structure

✅ **Navigation** (Expo Router):

- `mobile/src/app/_layout.tsx` — root `Stack` navigator, applies the design token
  palette (light/dark) to header and content backgrounds, renders the animated
  splash overlay, and mounts the `tabs` group as the single stack screen.
- `mobile/src/app/tabs/_layout.tsx` — renders `AppTabs`.
- `mobile/src/components/app-tabs.tsx` (`AppTabs`) — an Expo Router `Tabs` navigator
  with 5 tabs, each backed by a screen file under `mobile/src/app/tabs/`:
  - **Home** (`home.tsx`) — 🏠, `tabBarTestID: 'home-tab'`
  - **Search** (`search.tsx`) — 🔍, `tabBarTestID: 'search-tab'`
  - **Requests** (`requests.tsx`) — 📋, `tabBarTestID: 'requests-tab'`
  - **Chats** (`chats.tsx`) — 💬, `tabBarTestID: 'chats-tab'`
  - **Profile** (`profile.tsx`) — 👤, `tabBarTestID: 'profile-tab'`

  Tab bar colors (active/inactive tint, surface background) are derived from
  `palette.light` / `palette.dark` based on `useColorScheme()`.

## Component Gallery

A dev-only design review screen lives at `mobile/src/app/__gallery.tsx`
(route `/__gallery`). It renders every UI component — Button variants, Input
states, Card/BookCard, Avatar, Badge, Sheet, EmptyState, Skeleton, Toast, and
InlineError — in one scrollable view for visual QA.

> **Known follow-up:** the `__` prefix is a naming convention only, not an
> official Expo Router exclusion mechanism — the route may still be reachable
> at runtime. If this screen should never ship to production builds, consider
> moving it behind a `__DEV__` guard, an environment-based route group, or
> excluding it from the router's file scanning via Expo Router config.

## Design Tokens

✅ **Location:** `mobile/src/components/ui/tokens.ts` — single source of truth,
re-exported via `mobile/src/components/ui/index.ts`. Includes:

- `spacing` — 4-pt grid (`xs` 4 → `xxxl` 48)
- `fontSize` — type scale (`caption` 12 → `display` 32)
- `radius` — `input` (8), `sheet` (16), `pill` (999)
- `palette` — `light` and `dark` color sets (primary, background, surface,
  text, textMuted, accent, success, warning, danger, info)
- `elevation` — `card` (2), `sheet` (4)
- `shadows` — `card` and `sheet` shadow style objects (shadowColor/Offset/Opacity/Radius + elevation)

All UI components consume these tokens rather than hardcoding spacing,
color, radius, or font-size values.

## Usage

```typescript
import { Button, Input, BookCard, Avatar, Badge, EmptyState } from '@/components/ui';

<Button onPress={handlePress} variant="primary">
  Press me
</Button>

<Input
  label="Email"
  placeholder="Enter email"
  error="Invalid format"
/>

<BookCard
  title="The Great Gatsby"
  author="F. Scott Fitzgerald"
  condition="good"
  distance="3 km"
  onPress={handleCardPress}
/>

<EmptyState
  message="No books found"
  description="Try adjusting your search filters"
/>
```

## Testing

Testing is fully set up with **Jest + jest-expo + @testing-library/react-native (v13.3.3)**.

```bash
cd mobile
npm test               # Run all tests
npm run test:watch     # Watch mode
npm run test:coverage  # Coverage report
```

Current status: **13 test suites, 69 tests passing**, covering every UI
component, the design tokens, the app shell (`AppTabs`), the component
gallery, and a final cross-component integration suite
(`mobile/src/components/__tests__/integration.test.tsx`) that verifies the
barrel export and renders all components together.

Coverage on `src/components/ui` is roughly **86% statements / 88% branches**
as of this writing (several components — Avatar, Badge, EmptyState, Input,
Sheet, Skeleton, Toast, tokens — are at 100%).

## Design Principles

1. **Tokens first** — no hardcoded spacing, color, radius, or font-size values in components
2. **Accessibility** — minimum 44pt touch targets, AA contrast in both palettes
3. **Type safety** — full TypeScript support, with prop and variant types re-exported from the barrel
4. **Test coverage** — every component has a dedicated test suite plus an integration suite
5. **Documentation** — this file plus the `/__gallery` route for visual review

## Next Steps

1. Implement real screens (home feed, search results, requests, chats, profile) using these components
2. Add animation micro-interactions (e.g. skeleton shimmer, sheet transitions)
3. Dark mode polish — verify all components look correct against `palette.dark`
4. Wire up real data and navigation flows between screens
5. Address the `/__gallery` route exclusion follow-up noted above before production release
