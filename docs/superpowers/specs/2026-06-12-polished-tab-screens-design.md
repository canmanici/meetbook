# Polished Tab Screens — Design Spec

> Date: 2026-06-12
> Phase: 2 — Design system + app shell
> Status: Approved

## 1. Problem

All tab screens (Home, Search, Requests, Chats) are placeholder stubs with hardcoded
"Welcome" text. Profile is partially wired. None use the design system components
(tokens, Skeleton, EmptyState, Card, Button, Input, Badge). The app looks like an
Expo template instead of a polished product.

## 2. Goal

Replace all 5 tab screen stubs with polished layouts using the existing design system
components. Screens should show loading states (skeletons) or empty states so they look
finished and ready for backend data to flow in during Phase 3+.

## 3. Screen Designs

### 3.1 Home Screen (`tabs/home.tsx`)

**Job:** "Books near me"

Layout:
```
┌─────────────────────────────┐
│ 📍 Yakınlardaki Kitaplar    │  ← Header with location icon
│                             │
│ ┌─────────────────────────┐ │
│ │ [Skeleton card]         │ │  ← 3x Skeleton variant="card"
│ └─────────────────────────┘ │
│ ┌─────────────────────────┐ │
│ │ [Skeleton card]         │ │
│ └─────────────────────────┘ │
│ ┌─────────────────────────┐ │
│ │ [Skeleton card]         │ │
│ └─────────────────────────┘ │
└─────────────────────────────┘
```

- `SafeAreaView` wrapper with `palette.light.background` bg
- Header: Text "Yakınlardaki Kitaplar" in `fontSize.heading`, a small "📍" prefix
- Body: `ScrollView` with 3 `<Skeleton variant="card" />` components
- Uses tokens for all spacing/colors
- In Phase 3, TanStack Query replaces skeletons with real `BookCard` list

### 3.2 Search Screen (`tabs/search.tsx`)

**Job:** Find books and people

Layout:
```
┌─────────────────────────────┐
│ [🔍 Kitap veya yazar ara...]│  ← Input with search placeholder
│                             │
│ ┌─────────────────────────┐ │
│ │ [Skeleton card]         │ │  ← 3x Skeleton variant="card"
│ └─────────────────────────┘ │
│ ┌─────────────────────────┐ │
│ │ [Skeleton card]         │ │
│ └─────────────────────────┘ │
│ ┌─────────────────────────┐ │
│ │ [Skeleton card]         │ │
│ └─────────────────────────┘ │
└─────────────────────────────┘
```

- `SafeAreaView` wrapper
- Top: `<Input>` with placeholder "Kitap veya yazar ara...", `searchIcon` hint
- Body: 3 skeletons
- Input is presentational (no onSubmit yet — wired in Phase 3)

### 3.3 Requests Screen (`tabs/requests.tsx`)

**Job:** Exchange requests — sent/received

Layout:
```
┌─────────────────────────────┐
│  [Gönderilen] [Alınan]      │  ← Segmented tabs (visual)
│                             │
│      📋                     │
│   Henüz talep yok           │  ← EmptyState
│ Yakındaki kitaplardan       │
│   birini iste!              │
│                             │
│  [Kitaplara Göz At]         │  ← CTA → navigate to Home tab
└─────────────────────────────┘
```

- Segmented control: two `<TouchableOpacity>` buttons styled as tabs
  - "Gönderilen" (Sent) active by default
  - "Alınan" (Received)
  - Active tab: `palette.primary` bg, white text
  - Inactive tab: transparent bg, `palette.primary` text, border
- Below: `<EmptyState>` with book illustration emoji, message "Henüz talep yok",
  description "Yakınındaki kitaplardan birini iste!"
  - actionLabel: "Kitaplara Göz At" → navigates to Home tab
- State: `useState<'sent' | 'received'>('sent')` — both tabs show the same empty state for now

### 3.4 Chats Screen (`tabs/chats.tsx`)

**Job:** Conversations

Layout:
```
┌─────────────────────────────┐
│ Sohbetler                   │  ← Header
│                             │
│      💬                     │
│   Henüz sohbet yok          │  ← EmptyState
│ Bir kitap talebi kabul      │
│ edildiğinde burada görünür  │
│                             │
└─────────────────────────────┘
```

- Header: "Sohbetler" in `fontSize.heading`
- `<EmptyState>` with chat emoji illustration, message "Henüz sohbet yok",
  description "Bir kitap talebi kabul edildiğinde burada görünür"
- No action button (chats only appear after exchange acceptance)

### 3.5 Profile Screen (`tabs/profile.tsx`)

**Job:** Own profile, stats, settings

Layout:
```
┌─────────────────────────────┐
│         [Avatar]            │  ← Large Avatar with initials
│        Kullanıcı Adı        │  ← user?.name
│        email@email.com      │  ← user?.email
│                             │
│ ┌─────────────────────────┐ │
│ │ İstatistikler           │ │  ← Card section header
│ │ [0 takas] [0 kitap]     │ │  ← Badge placeholders
│ └─────────────────────────┘ │
│                             │
│ ┌─────────────────────────┐ │
│ │ Kitaplarım              │ │  ← Card section header
│ │ [EmptyState]            │ │  ← "Henüz kitap eklenmedi"
│ └─────────────────────────┘ │
│                             │
│    [Çıkış Yap]              │  ← Danger button
└─────────────────────────────┘
```

- Keep existing logout logic
- Wrap in ScrollView for longer content
- Avatar component (large, using user initials)
- Stats Card with Badge components: "0 takas", "0 kitap"
- "Kitaplarım" Card with inline EmptyState: "Henüz kitap eklenmedi"
- Logout Button at bottom

## 4. Shared Patterns

All screens follow these conventions:
- `SafeAreaView` from `react-native-safe-area-context` as root
- Tokens for all colors, spacing, font sizes — no raw values
- Turkish copy (warm, direct tone per design system)
- Each screen is a single file, no new components created
- `useColorScheme()` for dark/light theme support using `palette`

## 5. What This Is NOT

- No API calls (that's Phase 3)
- No TanStack Query hooks yet (skeletons are static)
- No navigation beyond the existing tab layout
- No new components — only composing existing ones

## 6. Files Changed

| File | Change |
|------|--------|
| `mobile/src/app/tabs/home.tsx` | Full rewrite — header + 3 skeletons |
| `mobile/src/app/tabs/search.tsx` | Full rewrite — search input + 3 skeletons |
| `mobile/src/app/tabs/requests.tsx` | Full rewrite — segmented tabs + empty state |
| `mobile/src/app/tabs/chats.tsx` | Full rewrite — header + empty state |
| `mobile/src/app/tabs/profile.tsx` | Enhance — add Avatar, stats card, books section |

## 7. Definition of Done

- [ ] All 5 tab screens use design system tokens and components
- [ ] No hardcoded raw color/spacing/font values
- [ ] Turkish copy throughout
- [ ] Home and Search show skeleton loading states
- [ ] Requests and Chats show meaningful empty states
- [ ] Profile shows user info, stats badges, and books empty state
- [ ] Existing tests still pass
- [ ] TypeScript compiles without new errors
