# MapPin Design System Components — Design Spec

> Date: 2026-06-12
> Phase: 2 — Design system + app shell
> Status: Approved

## 1. Problem

The design system (`src/components/ui/`) lacks map pin components. The location plan
requires two visually distinct pin types so users can instantly distinguish approximate
book/user locations from exact meetup points — "privacy made visible."

## 2. Design

### 2.1 Two pin types

| Pin | Component | Shape | Size | When used |
|-----|-----------|-------|------|-----------|
| BlurredArea | `BlurredAreaPin` | Soft circle | 24 pt | Book locations, user approximate areas |
| Exact | `ExactPin` | Teardrop marker | 28 pt | Confirmed meetup points |

Both are **pure React Native Views** — no map SDK dependency. They render as styled
`View` elements that can be dropped into any map library's marker/annotation as a child
view.

### 2.2 BlurredAreaPin

Soft dot representing an approximate ~1 km area. Communicates "this is a zone, not
an exact address."

- **Shape:** Circle, 24pt diameter
- **Fill:** `palette.primary` at 40% opacity
- **Border:** 1pt `palette.primary` at 20% opacity
- **States:** `default`, `selected` (scale 1.15, opacity 60%)
- **Optional `count` prop:** When clustering, shows a small number badge (12pt font,
  white text) centered in the dot. Badge background: `palette.primary` solid.

Props:
```typescript
interface BlurredAreaPinProps {
  count?: number;
  selected?: boolean;
  testID?: string;
}
```

### 2.3 ExactPin

Teardrop marker for precise meetup locations. Solid, unmistakable shape.

- **Shape:** Teardrop — filled circle body (16pt) + triangular stem pointing down (12pt height)
- **Total height:** ~28pt
- **Fill:** Solid `palette.primary`
- **Inner detail:** White dot (4pt) centered in the circle body
- **Variants:** `default`, `selected` (scale 1.15, shadow ring 2pt), `pending` (amber fill using `palette.accent`)

Props:
```typescript
type ExactPinVariant = 'default' | 'selected' | 'pending';

interface ExactPinProps {
  variant?: ExactPinVariant;
  testID?: string;
}
```

### 2.4 File layout

```
mobile/src/components/ui/
  mappin.tsx              ← BlurredAreaPin + ExactPin exports
  __tests__/
    mappin.test.tsx       ← render tests for both pins
  index.ts                ← add exports
```

### 2.5 Gallery additions

Add a "Map Pins" section to `__gallery.tsx` showing:
- BlurredAreaPin: default, selected, with count badge (3)
- ExactPin: default, selected, pending

All rendered over a neutral map-like background (dark gray rectangle) so the pins are
visible against a map surface.

### 2.6 Tokens

No new tokens. All sizing and colors come from existing `tokens.ts`:
- `palette.light.primary`, `palette.light.accent`, `palette.light.surface`
- Opacity values are component-local constants.

## 3. What this is NOT

- Not a map component — just the pin visuals.
- Not tied to react-native-maps or any specific map SDK.
- Not handling clustering logic — only rendering a `count` badge when given one.
- Not handling coordinate data — just visual elements.

## 4. Definition of Done

- [ ] `BlurredAreaPin` renders a soft circle in all states
- [ ] `ExactPin` renders a teardrop in all variants
- [ ] Both exported from `src/components/ui/index.ts`
- [ ] Tests pass for both components
- [ ] Gallery renders all pin states
- [ ] Pins are visible against a map-like background in gallery
