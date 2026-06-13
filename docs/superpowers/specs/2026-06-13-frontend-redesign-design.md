# MeetBook Frontend Redesign — Design Spec

## Overview

Complete frontend redesign of the MeetBook mobile app (Expo SDK 54, React Native, Expo Router v6). The redesign focuses on three pillars: **better spatial discovery via maps**, **polished modern UI**, and **improved feature usability**.

---

## 1. Navigation & Layout

### Tab Bar
- 5 tabs: Home, Search, Requests, Chats, Profile
- Tab icons: replace emojis with vector icons (Lucide or Ionicons)
- Active tab: `primary` color (#0F6E5D light / #3CA08D dark)
- Inactive: `textMuted`
- Badge counts on Requests and Chats tabs

### Home Screen — Hybrid Map/List Toggle
- **Default view**: List (current behavior, low-risk migration)
- **Toggle**: Floating pill button (top-right of content area), like Google Maps layer button
- Toggle persists user preference via AsyncStorage
- **List view**: Same as current but with refined BookCard design
- **Map view**: Full `react-native-maps` MapView with book cover image pins

### Search Screen — Same Hybrid Toggle
- Inherits the same map/list toggle from Home
- Filter icon opens a bottom sheet with full filter controls

---

## 2. Map System

### Book Cover Pins
- Each book displays its cover image as a map pin (48×64px, rounded corners, white border, drop shadow)
- Pin has a small triangle pointer at the bottom
- Tap a pin → opens a **bottom sheet** with book preview (cover, title, author, condition, distance, action buttons)

### Clustering
- When multiple books are within ~500m, they cluster into a green circle with count number
- **Tap cluster → zoom in** to spread out individual pins (NOT a list sheet)
- Zoom back out to re-cluster

### User Location
- Blue dot with pulse animation at center
- "Yakınım" button to re-center on user location

### Map Defaults
- Default region: Istanbul (41.0082, 28.9784)
- User's actual location used when available via `expo-location`

---

## 3. Screen Designs

### 3.1 Home (List View)
- Search bar at top (pill shape, camera icon for ISBN scan)
- Category quick-filter pills (scrollable horizontal)
- Active filter chips with ✕ dismiss
- Book cards: cover image (56×78px), title, author, condition badge, category tag, distance badge, "exchange iste" button, heart/favorite button
- Sort by: Yakınlık (default), En Yeni

### 3.2 Home (Map View)
- Floating search bar (top-left)
- Floating toggle pill (top-right)
- Book cover pins with clustering
- Bottom info bar: result count, "Yakınım" and "Yenile" buttons
- Tap pin → bottom sheet preview

### 3.3 Search
- Same hybrid toggle as Home
- **List view**: Search bar with camera icon, category/condition/language/distance chips, filtered results with same BookCard design
- **Map view**: Same as Home map but with search filters applied
- **Filter bottom sheet** (iOS-style):
  - Kategori: chip selector
  - Durum: chip selector
  - Mesafe: slider (100m → 100km)
  - Dil: chip selector (🇹🇷 Türkçe, 🇬🇧 English)
  - "Sıfırla" and "Uygula (N sonuç)" buttons

### 3.4 Book Detail — Visitor View
- Full-width photo gallery (240px height) with:
  - Glassmorphism back/action buttons
  - Photo counter badge (1/3)
  - Swipe dots
  - Gradient overlay with title, author, tags
- Info card: title, author, year, distance
- Stats row: Durum, Dil, Kategori (3 stat boxes)
- Description card
- Owner card: avatar (gradient initials), name, exchange count, rating, "Profil" button
- Sticky "exchange İsteği Gönder" button at bottom

### 3.5 Book Detail — Owner View
- Same gallery with edit/delete icons
- Availability badge (Müsait / Müsait Değil)
- Stats card: Talep count, Görüntülenme, Favori, gün yayında
- Location card with "haritada göster" link
- Edit and "Müsaitliği Kapat" action buttons
- Pending requests list: avatar, name, time, accept/reject buttons

### 3.6 Create Book — 4-Step Wizard
- **Progress bar**: 4 steps (Fotoğraf → Kitap → Detay → Konum), completed=✓, active=number, pending=gray
- **Step 1 — Fotoğraf**: Photo upload slots with preview, remove buttons, tip card
- **Step 2 — Kitap**: ISBN scan button (camera icon), manual form (title, author), ISBN auto-fill result card
- **Step 3 — Detay**: Category chips, Condition chips, Language chips, Description textarea
- **Step 4 — Konum**: Mini map with pin, "Konumum" button, privacy notice card, "Kitabı Yayınla" button

### 3.7 Exchange Detail
- Book + counterpart card at top (cover, title, condition, owner info)
- Visual step timeline (5 steps):
  1. Talep Gönderildi (done ✓)
  2. Onay Bekleniyor (active, pulsing)
  3. Buluşma Belirlenecek (pending)
  4. Buluşma (pending)
  5. Tamamlandı (pending)
- Action buttons: Onayla (gradient green) / Reddet (outline)
- Meetup section:
  - Suggested safe places list (name, category, distance, rating, "Seç" button)
  - Security tip card (green)
- Share with trusted contact button (blue)
- Cancel zone at bottom (red border)

### 3.8 Wishlist
- Search/add input with + button
- Wishlist items card:
  - Book cover, title, author
  - Match status: green ✓ (eşleşme bulundu) or amber clock (bekleniyor)
  - Remove button (red)
- "Yakınınızda Eşleşenler" horizontal scroll section
  - Mini cards with cover, distance badge, title, author, "exchange iste" button

### 3.9 Requests
- Tabbed view: Gelen (incoming) / Giden (outgoing)
- **Incoming requests**:
  - Avatar (gradient), name, book wanted, time, status badge
  - Action buttons: Onayla (gradient) / Reddet (outline)
- **Outgoing requests**:
  - Book thumbnail (gradient), who it was requested from, book name, time
  - Status badge: Bekliyor (amber), Onaylandı (green), Reddedildi (red), Tamamlandı (blue)

### 3.10 Profile
- Gradient hero section with avatar (gradient initials, verified badge)
- Name, email, join date
- Stats row: exchange count, Kitap count, Puan (with colored top borders)
- iOS-style menu sections:
  - Kitaplarım (badge count)
  - istek Listem (badge count)
  - Güvendiğim Kişi
  - Gizlilik & Güvenlik
  - Ayarlar
  - Çıkış Yap (red)
- Footer: MeetBook v1.0.0

---

## 4. Design System

### Colors (unchanged from current)
```
palette.light:
  primary: #0F6E5D    background: #F7F5F0    surface: #FFFFFF
  text: #1C1B18       textMuted: #6B6760     accent: #D97706
  success: #15803D    warning: #B45309       danger: #B91C1C    info: #1D4ED8

palette.dark:
  primary: #3CA08D    background: #161513    surface: #22211E
  text: #F0EEE8       textMuted: #A39E94     accent: #F59E0B
  success: #4ADE80    warning: #FBBF24       danger: #F87171    info: #60A5FA
```

### Spacing
```
xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48
```

### Border Radius
```
input: 8, card: 16-18, sheet: 20-24, pill: 999, button: 12-14
```

### Shadows
- Cards: `0 1px 2px rgba(0,0,0,0.03), 0 8px 28px rgba(0,0,0,0.05)`
- Buttons: `0 3px 12px rgba(15,110,93,0.3)` (primary)
- Pins: `0 3px 12px rgba(0,0,0,0.35)`

### Typography
```
caption: 11-12px, bodySm: 13px, body: 14px, title: 16-18px, heading: 20-24px, display: 26-28px
weights: 600 (semibold), 700 (bold), 800 (extrabold)
letter-spacing: -0.3px to -0.5px on large headings
```

---

## 5. Component Library Updates

### New Components
- `MapBookPin` — Book cover image pin for map
- `ClusterPin` — Green circle with count
- `BottomSheetPreview` — Book preview on pin tap
- `FilterSheet` — iOS-style filter bottom sheet
- `StepProgress` — 4-step wizard progress bar
- `TimelineStep` — Exchange timeline step
- `SuggestedPlace` — Meetup suggestion card

### Updated Components
- `BookCard` — Redesigned with cover image, distance badge, action buttons
- `AppTabs` — Vector icons instead of emojis, badge counts
- `Button` — Gradient primary variant
- `Badge` — New status variants (pending amber, completed blue)
- `Avatar` — Gradient background option

---

## 6. Tech Decisions

- **Map**: Continue using `react-native-maps` (already installed)
- **Clustering**: Use `react-native-map-clustering` or custom implementation
- **Bottom Sheets**: Use `@gorhom/bottom-sheet` (already installed via package.json)
- **Icons**: Add `@expo/vector-icons` or `lucide-react-native`
- **AsyncStorage**: Use for persisting map/list toggle preference
- **Photo gallery**: Implement swipeable gallery with `react-native-reanimated` or flatlist horizontal

---

## 7. File Structure (Proposed)

```
src/
  app/
    tabs/
      home.tsx          # Hybrid map/list home
      search.tsx         # Hybrid map/list search
      requests.tsx       # Redesigned requests
      chats.tsx          # (unchanged for now)
      profile.tsx        # Redesigned profile
    book/
      [id].tsx           # Redesigned book detail (visitor + owner)
      new.tsx            # 4-step wizard
      my-books.tsx       # (minor updates)
      location-picker.tsx # (minor updates)
    exchange/
      [id].tsx           # Redesigned exchange detail
    wishlist/
      index.tsx          # Redesigned wishlist
  components/
    ui/
      map-book-pin.tsx   # NEW
      cluster-pin.tsx    # NEW
      bottom-sheet-preview.tsx  # NEW
      filter-sheet.tsx   # NEW
      step-progress.tsx  # NEW
      timeline-step.tsx  # NEW
      suggested-place.tsx # NEW
      book-card.tsx      # REDESIGNED
      app-tabs.tsx       # REDESIGNED (vector icons)
      button.tsx         # UPDATED (gradient variant)
      badge.tsx          # UPDATED (new variants)
```

---

## 8. Implementation Priority

1. **Design system updates** — tokens, new components, updated components
2. **Home screen** — Hybrid toggle, list view, map view with pins
3. **Search screen** — Same toggle, filter sheet
4. **Book detail** — Visitor + owner views
5. **Create book** — 4-step wizard
6. **Exchange detail** — Timeline, meetup, actions
7. **Wishlist** — Match cards, nearby matches
8. **Requests** — Tabbed view, status badges
9. **Profile** — Hero, stats, menu
10. **Polish** — Animations, transitions, dark mode refinement
