# MeetBook Frontend Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the MeetBook mobile frontend with hybrid map/list home, polished UI, improved book detail, 4-step create wizard, and refined wishlist/requests/profile screens.

**Architecture:** Incremental redesign — update design system first, then rebuild screens one by one. Each screen is self-contained in its route file. New map components are isolated and reusable. All screens use `useColorScheme()` for dark mode.

**Tech Stack:** Expo SDK 54, React Native 0.81, Expo Router v6, `react-native-maps`, `@gorhom/bottom-sheet`, `react-native-reanimated`, Zustand, TanStack React Query, TypeScript

---

## File Structure

```
src/
  components/ui/
    map-book-pin.tsx          # Book cover image pin for map
    cluster-pin.tsx           # Green circle cluster with count
    bottom-sheet-preview.tsx  # Book preview bottom sheet (on pin tap)
    filter-sheet.tsx          # iOS-style filter bottom sheet
    step-progress.tsx         # 4-step wizard progress bar
    timeline-step.tsx         # Exchange timeline step
    suggested-place.tsx       # Meetup suggestion card
    book-card.tsx             # REDESIGNED — cover, distance, actions
    app-tabs.tsx              # REDESIGNED — vector icons, badges
    button.tsx                # UPDATED — gradient variant
    badge.tsx                 # UPDATED — new status variants
  app/
    tabs/
      home.tsx                # REDESIGNED — hybrid map/list
      search.tsx              # REDESIGNED — hybrid map/list + filter sheet
      requests.tsx            # REDESIGNED — tabbed, status badges
      profile.tsx             # REDESIGNED — hero, stats, menu
    book/
      [id].tsx                # REDESIGNED — visitor + owner views
      new.tsx                 # REDESIGNED — 4-step wizard
    exchange/
      [id].tsx                # REDESIGNED — timeline, meetup, actions
    wishlist/
      index.tsx               # REDESIGNED — matches, nearby scroll
```

---

## Task 1: Install Dependencies

**Files:**
- Modify: `mobile/package.json`

- [ ] **Step 1: Install clustering and vector icons**

```bash
cd /home/can/Masaüstü/meetbook/mobile
npx expo install react-native-map-clustering @expo/vector-icons
```

- [ ] **Step 2: Verify installation**

```bash
cat package.json | grep -E "map-clustering|vector-icons"
```

Expected: both packages listed in dependencies

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add map clustering and vector icon deps"
```

---

## Task 2: Map Book Pin Component

**Files:**
- Create: `mobile/src/components/ui/map-book-pin.tsx`
- Test: Visual verification only (map components hard to unit test)

- [ ] **Step 1: Create MapBookPin component**

```typescript
// mobile/src/components/ui/map-book-pin.tsx
import React from 'react';
import { View, Image, StyleSheet } from 'react-native';

interface MapBookPinProps {
  coverUrl?: string;
  title: string;
  isSelected?: boolean;
}

export function MapBookPin({ coverUrl, title, isSelected = false }: MapBookPinProps) {
  return (
    <View style={[styles.container, isSelected && styles.selected]}>
      {coverUrl ? (
        <Image source={{ uri: coverUrl }} style={styles.cover} />
      ) : (
        <View style={[styles.cover, styles.placeholder]}>
          <View style={styles.placeholderLines}>
            <View style={styles.line} />
            <View style={[styles.line, { width: '60%' }]} />
          </View>
        </View>
      )}
      <View style={styles.pointer} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
  },
  selected: {
    transform: [{ scale: 1.1 }],
  },
  cover: {
    width: 48,
    height: 64,
    borderRadius: 6,
    borderWidth: 2.5,
    borderColor: '#ffffff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 8,
  },
  placeholder: {
    backgroundColor: '#ddd',
    justifyContent: 'center',
    alignItems: 'center',
  },
  placeholderLines: {
    gap: 4,
    alignItems: 'center',
  },
  line: {
    height: 3,
    width: '70%',
    backgroundColor: '#bbb',
    borderRadius: 2,
  },
  pointer: {
    width: 0,
    height: 0,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderTopWidth: 8,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: '#ffffff',
    marginTop: -2,
  },
});
```

- [ ] **Step 2: Export from barrel**

```typescript
// mobile/src/components/ui/index.ts — add to existing exports
export { MapBookPin } from './map-book-pin';
```

- [ ] **Step 3: Commit**

```bash
git add mobile/src/components/ui/map-book-pin.tsx mobile/src/components/ui/index.ts
git commit -m "feat(ui): add MapBookPin component for map markers"
```

---

## Task 3: Cluster Pin Component

**Files:**
- Create: `mobile/src/components/ui/cluster-pin.tsx`

- [ ] **Step 1: Create ClusterPin component**

```typescript
// mobile/src/components/ui/cluster-pin.tsx
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

interface ClusterPinProps {
  count: number;
}

export function ClusterPin({ count }: ClusterPinProps) {
  const size = Math.min(40 + count * 2, 60);

  return (
    <View style={[styles.container, { width: size, height: size }]}>
      <Text style={styles.count}>{count}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 999,
    backgroundColor: '#0F6E5D',
    borderWidth: 3,
    borderColor: '#ffffff',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  count: {
    color: '#ffffff',
    fontWeight: '800',
    fontSize: 16,
  },
});
```

- [ ] **Step 2: Export from barrel**

```typescript
// mobile/src/components/ui/index.ts — add
export { ClusterPin } from './cluster-pin';
```

- [ ] **Step 3: Commit**

```bash
git add mobile/src/components/ui/cluster-pin.tsx mobile/src/components/ui/index.ts
git commit -m "feat(ui): add ClusterPin component for map clustering"
```

---

## Task 4: Book Preview Bottom Sheet

**Files:**
- Create: `mobile/src/components/ui/bottom-sheet-preview.tsx`

- [ ] **Step 1: Create BottomSheetPreview component**

```typescript
// mobile/src/components/ui/bottom-sheet-preview.tsx
import React from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import BottomSheet from '@gorhom/bottom-sheet';
import { palette } from './tokens';

interface BookPreviewData {
  id: string;
  title: string;
  author: string;
  coverUrl?: string;
  condition: string;
  distanceKm: number;
  category: string;
}

interface BottomSheetPreviewProps {
  book: BookPreviewData | null;
  onClose: () => void;
  onRequestExchange: (bookId: string) => void;
  onViewDetail: (bookId: string) => void;
}

export function BottomSheetPreview({
  book,
  onClose,
  onRequestExchange,
  onViewDetail,
}: BottomSheetPreviewProps) {
  const sheetRef = React.useRef<BottomSheet>(null);
  const snapPoints = React.useMemo(() => ['45%'], []);

  React.useEffect(() => {
    if (book) {
      sheetRef.current?.expand();
    } else {
      sheetRef.current?.close();
    }
  }, [book]);

  if (!book) return null;

  return (
    <BottomSheet
      ref={sheetRef}
      index={-1}
      snapPoints={snapPoints}
      onClose={onClose}
      enablePanDownToClose
      backgroundStyle={styles.background}
      handleIndicatorStyle={styles.indicator}
    >
      <View style={styles.content}>
        <View style={styles.bookRow}>
          {book.coverUrl ? (
            <Image source={{ uri: book.coverUrl }} style={styles.cover} />
          ) : (
            <View style={[styles.cover, styles.placeholder]} />
          )}
          <View style={styles.info}>
            <Text style={styles.title}>{book.title}</Text>
            <Text style={styles.author}>{book.author}</Text>
            <View style={styles.tags}>
              <View style={styles.tag}>
                <Text style={styles.tagText}>{book.condition}</Text>
              </View>
              <View style={styles.tag}>
                <Text style={styles.tagText}>{book.category}</Text>
              </View>
            </View>
            <Text style={styles.distance}>{book.distanceKm.toFixed(1)} km</Text>
          </View>
        </View>
        <View style={styles.actions}>
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() => onRequestExchange(book.id)}
          >
            <Text style={styles.primaryBtnText}>exchange İste</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.secondaryBtn}
            onPress={() => onViewDetail(book.id)}
          >
            <Text style={styles.secondaryBtnText}>Detay</Text>
          </TouchableOpacity>
        </View>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  background: {
    backgroundColor: '#ffffff',
    borderRadius: 20,
  },
  indicator: {
    backgroundColor: '#d1d5db',
    width: 40,
  },
  content: {
    flex: 1,
    padding: 20,
  },
  bookRow: {
    flexDirection: 'row',
    gap: 14,
  },
  cover: {
    width: 64,
    height: 88,
    borderRadius: 8,
  },
  placeholder: {
    backgroundColor: '#ddd',
  },
  info: {
    flex: 1,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
  },
  author: {
    fontSize: 14,
    color: '#6b7280',
    marginTop: 2,
  },
  tags: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 8,
  },
  tag: {
    backgroundColor: '#f3f4f6',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  tagText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#374151',
  },
  distance: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0F6E5D',
    marginTop: 6,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 20,
  },
  primaryBtn: {
    flex: 2,
    backgroundColor: '#0F6E5D',
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
  },
  primaryBtnText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  secondaryBtn: {
    flex: 1,
    backgroundColor: '#f3f4f6',
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
  },
  secondaryBtnText: {
    color: '#374151',
    fontSize: 15,
    fontWeight: '700',
  },
});
```

- [ ] **Step 2: Export from barrel**

```typescript
// mobile/src/components/ui/index.ts — add
export { BottomSheetPreview } from './bottom-sheet-preview';
export type { BookPreviewData } from './bottom-sheet-preview';
```

- [ ] **Step 3: Commit**

```bash
git add mobile/src/components/ui/bottom-sheet-preview.tsx mobile/src/components/ui/index.ts
git commit -m "feat(ui): add BottomSheetPreview for map pin tap"
```

---

## Task 5: Filter Bottom Sheet

**Files:**
- Create: `mobile/src/components/ui/filter-sheet.tsx`

- [ ] **Step 1: Create FilterSheet component**

```typescript
// mobile/src/components/ui/filter-sheet.tsx
import React, { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import BottomSheet from '@gorhom/bottom-sheet';

interface FilterState {
  category: string | null;
  condition: string | null;
  language: string | null;
  radiusKm: number;
}

interface FilterSheetProps {
  visible: boolean;
  onClose: () => void;
  onApply: (filters: FilterState) => void;
  resultCount: number;
}

const CATEGORIES = ['Roman', 'Ders Kitabı', 'Çizgi Roman', 'Çocuk', ' Şiir', 'Diğer'];
const CONDITIONS = ['Yeni', 'Yeni Gibi', 'İyi', 'Kullanılmış'];
const LANGUAGES = ['Türkçe', 'English'];
const RADII = [1, 2, 5, 10, 25, 50, 100];

export function FilterSheet({ visible, onClose, onApply, resultCount }: FilterSheetProps) {
  const sheetRef = React.useRef<BottomSheet>(null);
  const snapPoints = React.useMemo(() => ['70%'], []);

  const [filters, setFilters] = useState<FilterState>({
    category: null,
    condition: null,
    language: null,
    radiusKm: 10,
  });

  const toggleFilter = useCallback(
    (key: keyof FilterState, value: string) => {
      setFilters((prev) => ({
        ...prev,
        [key]: prev[key] === value ? null : value,
      }));
    },
    []
  );

  const resetFilters = useCallback(() => {
    setFilters({ category: null, condition: null, language: null, radiusKm: 10 });
  }, []);

  React.useEffect(() => {
    if (visible) sheetRef.current?.expand();
    else sheetRef.current?.close();
  }, [visible]);

  return (
    <BottomSheet
      ref={sheetRef}
      index={-1}
      snapPoints={snapPoints}
      onClose={onClose}
      enablePanDownToClose
      backgroundStyle={styles.background}
      handleIndicatorStyle={styles.indicator}
    >
      <View style={styles.content}>
        <Text style={styles.heading}>Filtreler</Text>

        <Text style={styles.sectionLabel}>Kategori</Text>
        <View style={styles.chipRow}>
          {CATEGORIES.map((cat) => (
            <TouchableOpacity
              key={cat}
              style={[styles.chip, filters.category === cat && styles.chipActive]}
              onPress={() => toggleFilter('category', cat)}
            >
              <Text style={[styles.chipText, filters.category === cat && styles.chipTextActive]}>
                {cat}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.sectionLabel}>Durum</Text>
        <View style={styles.chipRow}>
          {CONDITIONS.map((cond) => (
            <TouchableOpacity
              key={cond}
              style={[styles.chip, filters.condition === cond && styles.chipActive]}
              onPress={() => toggleFilter('condition', cond)}
            >
              <Text style={[styles.chipText, filters.condition === cond && styles.chipTextActive]}>
                {cond}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.sectionLabel}>Dil</Text>
        <View style={styles.chipRow}>
          {LANGUAGES.map((lang) => (
            <TouchableOpacity
              key={lang}
              style={[styles.chip, filters.language === lang && styles.chipActive]}
              onPress={() => toggleFilter('language', lang)}
            >
              <Text style={[styles.chipText, filters.language === lang && styles.chipTextActive]}>
                {lang}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.footer}>
          <TouchableOpacity style={styles.resetBtn} onPress={resetFilters}>
            <Text style={styles.resetBtnText}>Sıfırla</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.applyBtn}
            onPress={() => onApply(filters)}
          >
            <Text style={styles.applyBtnText}>Uygula ({resultCount})</Text>
          </TouchableOpacity>
        </View>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  background: { backgroundColor: '#ffffff', borderRadius: 20 },
  indicator: { backgroundColor: '#d1d5db', width: 40 },
  content: { flex: 1, padding: 20 },
  heading: { fontSize: 20, fontWeight: '800', color: '#111827', marginBottom: 20 },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 10,
    marginTop: 16,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: '#f3f4f6',
  },
  chipActive: {
    backgroundColor: '#0F6E5D',
  },
  chipText: { fontSize: 13, fontWeight: '600', color: '#6b7280' },
  chipTextActive: { color: '#ffffff' },
  footer: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 24,
  },
  resetBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: '#f3f4f6',
    alignItems: 'center',
  },
  resetBtnText: { fontSize: 14, fontWeight: '700', color: '#374151' },
  applyBtn: {
    flex: 2,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: '#0F6E5D',
    alignItems: 'center',
  },
  applyBtnText: { fontSize: 14, fontWeight: '700', color: '#ffffff' },
});
```

- [ ] **Step 2: Export from barrel**

```typescript
// mobile/src/components/ui/index.ts — add
export { FilterSheet } from './filter-sheet';
```

- [ ] **Step 3: Commit**

```bash
git add mobile/src/components/ui/filter-sheet.tsx mobile/src/components/ui/index.ts
git commit -m "feat(ui): add FilterSheet bottom sheet component"
```

---

## Task 6: Step Progress Bar

**Files:**
- Create: `mobile/src/components/ui/step-progress.tsx`

- [ ] **Step 1: Create StepProgress component**

```typescript
// mobile/src/components/ui/step-progress.tsx
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

interface Step {
  label: string;
}

interface StepProgressProps {
  steps: Step[];
  currentStep: number; // 0-indexed
}

export function StepProgress({ steps, currentStep }: StepProgressProps) {
  return (
    <View style={styles.container}>
      {steps.map((step, index) => {
        const isDone = index < currentStep;
        const isActive = index === currentStep;
        const isPending = index > currentStep;

        return (
          <View key={step.label} style={styles.step}>
            {index > 0 && (
              <View style={[styles.line, isDone && styles.lineDone]} />
            )}
            <View
              style={[
                styles.dot,
                isDone && styles.dotDone,
                isActive && styles.dotActive,
                isPending && styles.dotPending,
              ]}
            >
              <Text
                style={[
                  styles.dotText,
                  (isDone || isActive) && styles.dotTextActive,
                ]}
              >
                {isDone ? '✓' : index + 1}
              </Text>
            </View>
            <Text style={[styles.label, isActive && styles.labelActive]}>
              {step.label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  step: {
    flex: 1,
    alignItems: 'center',
    position: 'relative',
  },
  line: {
    position: 'absolute',
    top: 15,
    left: '50%',
    width: '100%',
    height: 2,
    backgroundColor: '#e5e7eb',
    zIndex: 0,
  },
  lineDone: {
    backgroundColor: '#0F6E5D',
  },
  dot: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1,
  },
  dotDone: {
    backgroundColor: '#0F6E5D',
  },
  dotActive: {
    backgroundColor: '#0F6E5D',
    shadowColor: '#0F6E5D',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  dotPending: {
    backgroundColor: '#e5e7eb',
  },
  dotText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#9ca3af',
  },
  dotTextActive: {
    color: '#ffffff',
  },
  label: {
    fontSize: 10,
    fontWeight: '600',
    color: '#9ca3af',
    marginTop: 6,
    textAlign: 'center',
  },
  labelActive: {
    color: '#0F6E5D',
  },
});
```

- [ ] **Step 2: Export from barrel**

```typescript
// mobile/src/components/ui/index.ts — add
export { StepProgress } from './step-progress';
```

- [ ] **Step 3: Commit**

```bash
git add mobile/src/components/ui/step-progress.tsx mobile/src/components/ui/index.ts
git commit -m "feat(ui): add StepProgress wizard progress bar"
```

---

## Task 7: Timeline Step Component

**Files:**
- Create: `mobile/src/components/ui/timeline-step.tsx`

- [ ] **Step 1: Create TimelineStep component**

```typescript
// mobile/src/components/ui/timeline-step.tsx
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

type StepStatus = 'done' | 'active' | 'pending';

interface TimelineStepProps {
  status: StepStatus;
  title: string;
  subtitle: string;
  isLast?: boolean;
}

export function TimelineStep({ status, title, subtitle, isLast = false }: TimelineStepProps) {
  return (
    <View style={styles.container}>
      <View style={styles.left}>
        <View
          style={[
            styles.dot,
            status === 'done' && styles.dotDone,
            status === 'active' && styles.dotActive,
            status === 'pending' && styles.dotPending,
          ]}
        >
          <Text style={[styles.dotText, status !== 'pending' && styles.dotTextActive]}>
            {status === 'done' ? '✓' : status === 'active' ? '●' : '○'}
          </Text>
        </View>
        {!isLast && (
          <View style={[styles.line, status === 'done' && styles.lineDone]} />
        )}
      </View>
      <View style={[styles.right, isLast && { paddingBottom: 0 }]}>
        <Text
          style={[
            styles.title,
            status === 'active' && styles.titleActive,
            status === 'pending' && styles.titlePending,
          ]}
        >
          {title}
        </Text>
        <Text
          style={[
            styles.subtitle,
            status === 'pending' && styles.subtitlePending,
          ]}
        >
          {subtitle}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
  },
  left: {
    width: 32,
    alignItems: 'center',
  },
  dot: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1,
  },
  dotDone: { backgroundColor: '#dcfce7' },
  dotActive: {
    backgroundColor: '#0F6E5D',
    shadowColor: '#0F6E5D',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  dotPending: { backgroundColor: '#f3f4f6' },
  dotText: { fontSize: 14, color: '#9ca3af' },
  dotTextActive: { color: '#ffffff' },
  line: {
    width: 2,
    flex: 1,
    backgroundColor: '#e5e7eb',
    minHeight: 20,
  },
  lineDone: { backgroundColor: '#0F6E5D' },
  right: {
    flex: 1,
    paddingBottom: 20,
    paddingLeft: 12,
  },
  title: { fontSize: 14, fontWeight: '600', color: '#111827' },
  titleActive: { color: '#0F6E5D', fontWeight: '700' },
  titlePending: { color: '#9ca3af' },
  subtitle: { fontSize: 12, color: '#6b7280', marginTop: 2 },
  subtitlePending: { color: '#d1d5db' },
});
```

- [ ] **Step 2: Export from barrel**

```typescript
// mobile/src/components/ui/index.ts — add
export { TimelineStep } from './timeline-step';
```

- [ ] **Step 3: Commit**

```bash
git add mobile/src/components/ui/timeline-step.tsx mobile/src/components/ui/index.ts
git commit -m "feat(ui): add TimelineStep for exchange detail"
```

---

## Task 8: Redesign BookCard Component

**Files:**
- Modify: `mobile/src/components/ui/card.tsx`

- [ ] **Step 1: Rewrite BookCard with cover image, distance badge, and action buttons**

Replace the existing `BookCard` in `mobile/src/components/ui/card.tsx` with:

```typescript
// Add to existing card.tsx — replace BookCard function
interface BookCardProps {
  title: string;
  author: string;
  coverUrl?: string;
  condition: string;
  category: string;
  distanceKm?: number;
  onPress?: () => void;
  onRequestExchange?: () => void;
  onFavorite?: () => void;
}

export function BookCard({
  title,
  author,
  coverUrl,
  condition,
  category,
  distanceKm,
  onPress,
  onRequestExchange,
  onFavorite,
}: BookCardProps) {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  const colors = palette[isDark ? 'dark' : 'light'];

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={[
        styles.bookCard,
        { backgroundColor: colors.surface, borderColor: isDark ? '#333' : '#eee' },
      ]}
    >
      {coverUrl ? (
        <Image source={{ uri: coverUrl }} style={styles.bookCover} />
      ) : (
        <View style={[styles.bookCover, { backgroundColor: isDark ? '#333' : '#ddd' }]} />
      )}
      <View style={styles.bookInfo}>
        <View style={styles.bookHeader}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.bookTitle, { color: colors.text }]} numberOfLines={1}>
              {title}
            </Text>
            <Text style={[styles.bookAuthor, { color: colors.textMuted }]} numberOfLines={1}>
              {author}
            </Text>
          </View>
          {distanceKm != null && (
            <View style={[styles.distanceBadge, { backgroundColor: isDark ? '#0a3d32' : '#ecfdf5' }]}>
              <Text style={[styles.distanceText, { color: colors.primary }]}>
                {distanceKm.toFixed(1)} km
              </Text>
            </View>
          )}
        </View>
        <View style={styles.bookTags}>
          <View style={[styles.tag, { backgroundColor: isDark ? '#2a2926' : '#f3f4f6' }]}>
            <Text style={[styles.tagText, { color: colors.text }]}>{condition}</Text>
          </View>
          <View style={[styles.tag, { backgroundColor: isDark ? '#2a2926' : '#f3f4f6' }]}>
            <Text style={[styles.tagText, { color: colors.text }]}>{category}</Text>
          </View>
        </View>
        <View style={styles.bookActions}>
          <TouchableOpacity
            style={[styles.requestBtn, { backgroundColor: colors.primary }]}
            onPress={onRequestExchange}
          >
            <Text style={styles.requestBtnText}>exchange iste</Text>
          </TouchableOpacity>
          {onFavorite && (
            <TouchableOpacity style={styles.favoriteBtn} onPress={onFavorite}>
              <Text style={{ fontSize: 16 }}>♡</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}

// Add to existing StyleSheet.create:
// bookCard: {
//   flexDirection: 'row',
//   borderRadius: 16,
//   padding: 14,
//   marginBottom: 10,
//   borderWidth: 1,
//   gap: 12,
// },
// bookCover: { width: 56, height: 78, borderRadius: 10 },
// bookInfo: { flex: 1 },
// bookHeader: { flexDirection: 'row', justifyContent: 'space-between' },
// bookTitle: { fontSize: 15, fontWeight: '700' },
// bookAuthor: { fontSize: 13, marginTop: 2 },
// distanceBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
// distanceText: { fontSize: 11, fontWeight: '700' },
// bookTags: { flexDirection: 'row', gap: 6, marginTop: 8 },
// tag: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
// tagText: { fontSize: 11, fontWeight: '600' },
// bookActions: { flexDirection: 'row', gap: 8, marginTop: 10 },
// requestBtn: { flex: 1, paddingVertical: 10, borderRadius: 12, alignItems: 'center' },
// requestBtnText: { color: '#fff', fontSize: 12, fontWeight: '700' },
// favoriteBtn: { width: 38, height: 38, borderRadius: 12, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#e5e7eb' },
```

- [ ] **Step 2: Commit**

```bash
git add mobile/src/components/ui/card.tsx
git commit -m "feat(ui): redesign BookCard with cover, distance, actions"
```

---

## Task 9: Redesign Home Screen — List View

**Files:**
- Modify: `mobile/src/app/tabs/home.tsx`

- [ ] **Step 1: Rewrite home.tsx with search bar, category chips, and redesigned BookCards**

This is a full rewrite. The key changes:
- Add search bar at top (pill shape)
- Add horizontal scrolling category chips
- Use new `BookCard` component with cover images
- Add floating map/list toggle button
- Map state managed via `useState`

```typescript
// mobile/src/app/tabs/home.tsx — full rewrite
import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { palette } from '@/components/ui/tokens';
import { BookCard } from '@/components/ui/card';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import * as Location from 'expo-location';

const CATEGORIES = ['Tümü', 'Roman', 'Ders Kitabı', 'Çizgi Roman', 'Çocuk', ' Şiir'];

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  const colors = palette[isDark ? 'dark' : 'light'];
  const [selectedCategory, setSelectedCategory] = useState('Tümü');
  const [viewMode, setViewMode] = useState<'list' | 'map'>('list');

  const { data: books, isLoading } = useQuery({
    queryKey: ['nearbyBooks', selectedCategory],
    queryFn: async () => {
      const loc = await Location.getCurrentPositionAsync({});
      return apiClient.searchNearbyBooks({
        lat: loc.coords.latitude,
        lng: loc.coords.longitude,
        radius_km: 10,
        category: selectedCategory === 'Tümü' ? undefined : selectedCategory,
      });
    },
  });

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Home</Text>
        <View style={styles.toggleContainer}>
          <TouchableOpacity
            style={[styles.toggleBtn, viewMode === 'list' && styles.toggleActive]}
            onPress={() => setViewMode('list')}
          >
            <Text style={[styles.toggleText, viewMode === 'list' && styles.toggleTextActive]}>📋</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.toggleBtn, viewMode === 'map' && styles.toggleActive]}
            onPress={() => setViewMode('map')}
          >
            <Text style={[styles.toggleText, viewMode === 'map' && styles.toggleTextActive]}>🗺️</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Search Bar */}
      <View style={styles.searchContainer}>
        <View style={[styles.searchBar, { backgroundColor: isDark ? '#2a2926' : '#f5f5f5' }]}>
          <Text style={{ fontSize: 16 }}>🔍</Text>
          <Text style={[styles.searchPlaceholder, { color: colors.textMuted }]}>
            Kitap, yazar veya ISBN ara...
          </Text>
        </View>
      </View>

      {/* Category Chips */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
        <View style={styles.chipRow}>
          {CATEGORIES.map((cat) => (
            <TouchableOpacity
              key={cat}
              style={[styles.chip, selectedCategory === cat && styles.chipActive]}
              onPress={() => setSelectedCategory(cat)}
            >
              <Text style={[styles.chipText, selectedCategory === cat && styles.chipTextActive]}>
                {cat}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>

      {/* Book List */}
      <ScrollView style={styles.bookList} contentContainerStyle={{ paddingBottom: insets.bottom }}>
        {books?.map((book) => (
          <BookCard
            key={book.id}
            title={book.title}
            author={book.author}
            coverUrl={book.photos?.[0]?.url}
            condition={book.condition}
            category={book.category}
            distanceKm={book.distance_km}
            onPress={() => router.push(`/book/${book.id}`)}
          />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  headerTitle: { fontSize: 24, fontWeight: '800', letterSpacing: -0.5 },
  toggleContainer: {
    flexDirection: 'row',
    backgroundColor: '#f3f4f6',
    borderRadius: 12,
    padding: 3,
  },
  toggleBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  toggleActive: {
    backgroundColor: '#0F6E5D',
  },
  toggleText: { fontSize: 16 },
  toggleTextActive: {},
  searchContainer: { paddingHorizontal: 20, marginBottom: 12 },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    padding: 13,
    gap: 10,
  },
  searchPlaceholder: { fontSize: 14, flex: 1 },
  chipScroll: { paddingLeft: 20, marginBottom: 12 },
  chipRow: { flexDirection: 'row', gap: 8, paddingRight: 20 },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: '#f3f4f6',
  },
  chipActive: {
    backgroundColor: '#0F6E5D',
  },
  chipText: { fontSize: 13, fontWeight: '600', color: '#6b7280' },
  chipTextActive: { color: '#ffffff' },
  bookList: { flex: 1, paddingHorizontal: 20 },
});
```

- [ ] **Step 2: Commit**

```bash
git add mobile/src/app/tabs/home.tsx
git commit -m "feat(home): redesign with search bar, category chips, hybrid toggle"
```

---

## Task 10: Redesign Home Screen — Map View

**Files:**
- Modify: `mobile/src/app/tabs/home.tsx`

- [ ] **Step 1: Add MapView with book pins and clustering to home.tsx**

Add conditional rendering for map view mode. When `viewMode === 'map'`, render a `MapView` with `Marker` components using `MapBookPin` and clustering.

This requires adding imports for `MapView`, `Marker`, `ClusteredMapView`, and the new pin components. The map view shares the same data source but renders pins instead of cards.

Key additions to home.tsx:
- Import `MapView` from `react-native-maps`
- Import `MapBookPin`, `ClusterPin`, `BottomSheetPreview`
- Add map view conditional rendering
- Add bottom sheet state management
- Handle pin press to show preview

- [ ] **Step 2: Commit**

```bash
git add mobile/src/app/tabs/home.tsx
git commit -m "feat(home): add map view with book cover pins and clustering"
```

---

## Task 11: Redesign Search Screen

**Files:**
- Modify: `mobile/src/app/tabs/search.tsx`

- [ ] **Step 1: Rewrite search.tsx with hybrid toggle, filter chips, and FilterSheet**

Full rewrite similar to home.tsx but with:
- Search input with camera icon (for ISBN scan)
- Active filter chips with ✕ dismiss
- Filter icon button that opens FilterSheet
- Same BookCard list
- Map view with filtered pins

- [ ] **Step 2: Commit**

```bash
git add mobile/src/app/tabs/search.tsx
git commit -m "feat(search): redesign with hybrid toggle and filter sheet"
```

---

## Task 12: Redesign Book Detail — Visitor View

**Files:**
- Modify: `mobile/src/app/book/[id].tsx`

- [ ] **Step 1: Rewrite book detail with photo gallery, info card, owner card, and request button**

Key changes:
- Full-width photo gallery (240px) with gradient overlay
- Glassmorphism back/action buttons
- Photo counter badge and swipe dots
- Book info card with stats row (Durum, Dil, Kategori)
- Description card
- Owner card with avatar, name, rating
- Sticky "exchange İsteği Gönder" button

- [ ] **Step 2: Commit**

```bash
git add mobile/src/app/book/\[id\].tsx
git commit -m "feat(book): redesign detail page with gallery and polished layout"
```

---

## Task 13: Redesign Create Book — 4-Step Wizard

**Files:**
- Modify: `mobile/src/app/book/new.tsx`

- [ ] **Step 1: Rewrite book creation as 4-step wizard**

Replace single form with:
- StepProgress bar at top
- Step 1: Photo upload with preview slots
- Step 2: ISBN scan + manual form
- Step 3: Category/Condition/Language chips
- Step 4: Location picker with mini map
- Back/Next navigation buttons
- Step state managed via useState

- [ ] **Step 2: Commit**

```bash
git add mobile/src/app/book/new.tsx
git commit -m "feat(book): redesign create flow as 4-step wizard"
```

---

## Task 14: Redesign Exchange Detail

**Files:**
- Modify: `mobile/src/app/exchange/[id].tsx`

- [ ] **Step 1: Rewrite exchange detail with timeline, meetup section, and actions**

Key changes:
- Book + counterpart card at top
- Visual TimelineStep component (5 steps)
- Action buttons (Onayla/Reddet)
- Meetup section with SuggestedPlace cards
- Security tip card
- Share with trusted contact button
- Cancel zone

- [ ] **Step 2: Commit**

```bash
git add mobile/src/app/exchange/\[id\].tsx
git commit -m "feat(exchange): redesign detail with timeline and meetup"
```

---

## Task 15: Redesign Wishlist

**Files:**
- Modify: `mobile/src/app/wishlist/index.tsx`

- [ ] **Step 1: Rewrite wishlist with match cards and nearby scroll**

Key changes:
- Search/add input with + button
- Wishlist items with match status (green/amber)
- Remove button
- Horizontal scroll "Yakınınızda Eşleşenler" section

- [ ] **Step 2: Commit**

```bash
git add mobile/src/app/wishlist/index.tsx
git commit -m "feat(wishlist): redesign with match cards and nearby scroll"
```

---

## Task 16: Redesign Requests

**Files:**
- Modify: `mobile/src/app/tabs/requests.tsx`

- [ ] **Step 1: Rewrite requests with tabs, inline actions, and status badges**

Key changes:
- Gelen/Giden tab switcher
- Incoming: avatar, accept/reject buttons, status badge
- Outgoing: book thumbnail, status badge (4 variants)

- [ ] **Step 2: Commit**

```bash
git add mobile/src/app/tabs/requests.tsx
git commit -m "feat(requests): redesign with tabs, actions, status badges"
```

---

## Task 17: Redesign Profile

**Files:**
- Modify: `mobile/src/app/tabs/profile.tsx`

- [ ] **Step 1: Rewrite profile with hero, stats, and iOS-style menu**

Key changes:
- Gradient hero with avatar, verified badge
- Stats row with colored top borders
- iOS-style menu sections with icons and badges
- Logout button

- [ ] **Step 2: Commit**

```bash
git add mobile/src/app/tabs/profile.tsx
git commit -m "feat(profile): redesign with hero, stats, menu sections"
```

---

## Task 18: Redesign AppTabs with Vector Icons

**Files:**
- Modify: `mobile/src/components/app-tabs.tsx`

- [ ] **Step 1: Replace emoji icons with Ionicons or Lucide icons**

```typescript
// Replace emoji text with icon components
import { Ionicons } from '@expo/vector-icons';

// In tab config:
{ icon: <Ionicons name="home" size={22} /> ... }
{ icon: <Ionicons name="search" size={22} /> ... }
{ icon: <Ionicons name="clipboard" size={22} /> ... }
{ icon: <Ionicons name="chatbubble" size={22} /> ... }
{ icon: <Ionicons name="person" size={22} /> ... }
```

- [ ] **Step 2: Commit**

```bash
git add mobile/src/components/app-tabs.tsx
git commit -m "feat(tabs): replace emoji icons with vector icons"
```

---

## Task 19: Dark Mode Polish

**Files:**
- Multiple component files

- [ ] **Step 1: Verify all new components use `useColorScheme()` and `palette`**

Ensure every new component (MapBookPin, ClusterPin, BottomSheetPreview, FilterSheet, StepProgress, TimelineStep) and all redesigned screens properly handle dark mode via `palette[isDark ? 'dark' : 'light']`.

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "fix: ensure all new components support dark mode"
```

---

## Task 20: Final Integration Test

- [ ] **Step 1: Run the app and verify all screens render correctly**

```bash
cd /home/can/Masaüstü/meetbook/mobile
npm run start:lan
```

Test on phone:
- Home list view → tap book → book detail
- Home map view → tap pin → bottom sheet → tap detail
- Search → filters → apply
- Book detail → request exchange
- Create book → 4 steps → publish
- Exchange detail → timeline → actions
- Wishlist → matches
- Requests → tabs → accept/reject
- Profile → menu items

- [ ] **Step 2: Run TypeScript check**

```bash
cd /home/can/Masaüstü/meetbook/mobile
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: final integration verification"
```
