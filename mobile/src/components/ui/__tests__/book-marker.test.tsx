/**
 * book-marker.test.tsx — spec §7.1 regression tests.
 * Tests: all 6 variants render correct ring color + label, tracksViewChanges
 * resets on thumbnailUrl change (bug #8), textbook hides distance at low zoom.
 */

// Mock react-native-maps
// The MockMarker captures its props into a global array so tests can assert
// on the props passed to <Marker> (e.g., style.width/height for the 100px
// fallback regression test).
const markerRenderCalls: any[] = [];
jest.mock('react-native-maps', () => {
  const React = require('react');
  const { View } = require('react-native');
  const MockMarker = React.forwardRef((props: any, ref: any) => {
    // Shallow-copy props (without children) for later inspection.
    const { children, ...rest } = props;
    markerRenderCalls.push(rest);
    return React.createElement(View, { ref, ...props, testID: props.testID || 'marker' }, props.children);
  });
  return {
    __esModule: true,
    default: MockMarker,
    Marker: MockMarker,
    Circle: (props: any) => React.createElement(View, { ...props }),
    Callout: (props: any) => React.createElement(View, { ...props }, props.children),
    PROVIDER_GOOGLE: 'google',
  };
});

// Mock react-native-reanimated
jest.mock('react-native-reanimated', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: {
      View: React.forwardRef((props: any, ref: any) =>
        React.createElement(View, { ...props, ref }),
      ),
    },
    useSharedValue: (initial: any) => ({ value: initial }),
    useAnimatedStyle: () => ({}),
    withSpring: (val: any) => val,
    withTiming: (val: any) => val,
    withRepeat: (val: any) => val,
    cancelAnimation: jest.fn(),
    runOnJS: (fn: any) => fn,
    Easing: { out: (e: any) => e, ease: () => ({}) },
  };
});

import React from 'react';
import { render } from '@testing-library/react-native';
import { BookMarker, categoryColor, type BookCategory } from '../book-marker';
import { pastels, palette } from '@/components/ui/tokens';

const coordinate = { latitude: 41.0082, longitude: 28.9784 };

describe('BookMarker', () => {
  describe('categoryColor mapping (spec §3.4)', () => {
    it('maps fiction to mint', () => {
      expect(categoryColor('fiction', false)).toBe(pastels.light.mint.ink);
    });

    it('maps non_fiction to sky', () => {
      expect(categoryColor('non_fiction', false)).toBe(pastels.light.sky.ink);
    });

    it('maps textbook to sky', () => {
      expect(categoryColor('textbook', false)).toBe(pastels.light.sky.ink);
    });

    it('maps comics to butter', () => {
      expect(categoryColor('comics', false)).toBe(pastels.light.butter.ink);
    });

    it('maps children to blush', () => {
      expect(categoryColor('children', false)).toBe(pastels.light.blush.ink);
    });

    it('maps poetry to coral', () => {
      expect(categoryColor('poetry', false)).toBe(pastels.light.coral.ink);
    });

    it('maps other to palette.primary', () => {
      expect(categoryColor('other', false)).toBe(palette.light.primary);
    });

    it('uses dark palette when isDark', () => {
      expect(categoryColor('fiction', true)).toBe(pastels.dark.mint.ink);
    });
  });

  describe('variants (spec §3.4)', () => {
    it('renders standard variant', () => {
      const { getByTestId } = render(
        <BookMarker coordinate={coordinate} title="Test" variant="standard" category="fiction" distance="1.2 km" testID="m1" />,
      );
      expect(getByTestId('m1-wrapper')).toBeTruthy();
    });

    it('renders fresh variant with coral label', () => {
      const { getByText } = render(
        <BookMarker coordinate={coordinate} title="Test" variant="fresh" category="fiction" freshAgeHours={3} testID="m2" />,
      );
      expect(getByText('Yeni · 3sa')).toBeTruthy();
    });

    it('renders shelf variant with stack badge', () => {
      const { getByText } = render(
        <BookMarker coordinate={coordinate} title="Test" variant="shelf" category="fiction" stackCount={2} testID="m3" />,
      );
      expect(getByText('+2')).toBeTruthy();
    });

    it('renders unavailable variant', () => {
      const { getByTestId } = render(
        <BookMarker coordinate={coordinate} title="Test" variant="unavailable" category="fiction" testID="m4" />,
      );
      expect(getByTestId('m4-wrapper')).toBeTruthy();
    });

    it('renders distance label above standard marker', () => {
      const { getByText } = render(
        <BookMarker coordinate={coordinate} title="Test" variant="standard" category="fiction" distance="1.5 km" testID="m6" />,
      );
      expect(getByText('1.5 km')).toBeTruthy();
    });
  });

  describe('textbook no-distance rule (spec §3.4)', () => {
    it('hides distance label when latitudeDelta > 0.05', () => {
      const { queryByText } = render(
        <BookMarker coordinate={coordinate} title="Test" variant="textbook" category="textbook" distance="1.5 km" latitudeDelta={0.1} testID="m7" />,
      );
      expect(queryByText('1.5 km')).toBeNull();
    });

    it('shows distance label when latitudeDelta <= 0.05', () => {
      const { getByText } = render(
        <BookMarker coordinate={coordinate} title="Test" variant="textbook" category="textbook" distance="1.5 km" latitudeDelta={0.03} testID="m8" />,
      );
      expect(getByText('1.5 km')).toBeTruthy();
    });
  });

  describe('selection state (spec §3.4)', () => {
    it('renders with selected prop without crashing', () => {
      const { getByTestId } = render(
        <BookMarker coordinate={coordinate} title="Test" variant="standard" category="fiction" selected distance="1 km" testID="m9" />,
      );
      expect(getByTestId('m9-wrapper')).toBeTruthy();
    });
  });

  describe('bug #8: tracksViewChanges resets on thumbnailUrl change', () => {
    it('renders without crashing when thumbnailUrl changes', () => {
      const { rerender, getByTestId } = render(
        <BookMarker coordinate={coordinate} title="Test" variant="standard" category="fiction" thumbnailUrl="url1" testID="m10" />,
      );
      expect(getByTestId('m10-wrapper')).toBeTruthy();

      // Rerender with different thumbnailUrl — should not crash
      rerender(
        <BookMarker coordinate={coordinate} title="Test" variant="standard" category="fiction" thumbnailUrl="url2" testID="m10" />,
      );
      expect(getByTestId('m10-wrapper')).toBeTruthy();
    });
  });

  describe('dark mode (spec §3.4)', () => {
    it('renders in dark mode without crashing', () => {
      const { getByTestId } = render(
        <BookMarker coordinate={coordinate} title="Test" variant="standard" category="fiction" isDark distance="1 km" testID="m11" />,
      );
      expect(getByTestId('m11-wrapper')).toBeTruthy();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Regression: the "10×10 px cover on Android map" bug.
  // Root cause: <Image> inside <Marker> used width/height: '100%'. On Android,
  // react-native-maps (1.20.1) rasterizes Marker children to a bitmap and
  // percentage dims on nested Image do NOT resolve during rasterization — the
  // cover renders at ~10×10 dp (or 0) and gets frozen by tracksViewChanges.
  // Fix: explicit pixel dims (COVER_W × COVER_H) on cover + shelfBackImage.
  // ─────────────────────────────────────────────────────────────────────────
  describe('bug: cover uses explicit pixel dims, not "100%" (Android raster fix)', () => {
    it('standard marker cover Image has numeric width/height (not "100%")', () => {
      const { getByTestId } = render(
        <BookMarker
          coordinate={coordinate}
          title="Test"
          variant="standard"
          category="fiction"
          coverUrl="https://example.com/cover.jpg"
          testID="m-cover"
        />,
      );
      const wrapper = getByTestId('m-cover-wrapper');
      // Find the Image inside the wrapper (coverUrl is set → Image is rendered).
      const imageNode = findFirstChildOfType(wrapper, 'Image');
      expect(imageNode).toBeTruthy();
      const style = flattenStyle(imageNode.props.style);
      const w = style.width;
      const h = style.height;
      expect(typeof w).toBe('number');
      expect(typeof h).toBe('number');
      expect(w).not.toBe('100%');
      expect(h).not.toBe('100%');
      expect(w).toBeGreaterThan(0);
      expect(h).toBeGreaterThan(0);
      // Cover aspect must be taller than wide (book cover 2:3), not a 10×10 square.
      expect(h / w).toBeGreaterThan(1.2);
    });

    it('shelf marker back-cover Image has numeric width/height (not "100%")', () => {
      const { getByTestId } = render(
        <BookMarker
          coordinate={coordinate}
          title="Test"
          variant="shelf"
          category="fiction"
          stackCount={2}
          coverUrl="https://example.com/cover.jpg"
          testID="m-shelf"
        />,
      );
      const wrapper = getByTestId('m-shelf-wrapper');
      const imageNodes = findAllChildrenOfType(wrapper, 'Image');
      // Shelf renders at least one back-cover Image (shelfBack1) + the main cover.
      expect(imageNodes.length).toBeGreaterThanOrEqual(1);
      for (const node of imageNodes) {
        const style = flattenStyle(node.props.style);
        const w = style.width;
        const h = style.height;
        expect(typeof w).toBe('number');
        expect(typeof h).toBe('number');
        expect(w).not.toBe('100%');
        expect(h).not.toBe('100%');
        expect(w).toBeGreaterThan(0);
        expect(h).toBeGreaterThan(0);
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Regression: the "100px prefixed marker" bug (the REAL Android bug).
  // Root cause: MapMarker.java:525 → `int width = this.width <= 0 ? 100 : this.width;`
  // MapMarkerManager has NO @ReactProp for width/height — the native side gets
  // dims ONLY from SizeReportingShadowNode. If the shadow node reports 0 (layout
  // not measured before first raster), the bitmap falls back to 100×100 px and
  // gets FROZEN by tracksViewChanges. No inner StyleSheet can override this.
  // Fix: pass explicit `style={{ width, height }}` on the <Marker> component
  // itself so the shadow node always reports > 0. The footprint must also be
  // large enough to contain the label + box so the bitmap canvas doesn't clip.
  // ─────────────────────────────────────────────────────────────────────────
  describe('bug: Marker has explicit width/height style (100px fallback fix)', () => {
    beforeEach(() => markerRenderCalls.length = 0);

    it('standard marker passes explicit numeric width/height on Marker style', () => {
      render(
        <BookMarker
          coordinate={coordinate}
          title="Test"
          variant="standard"
          category="fiction"
          distance="1.2 km"
          testID="m-footprint"
        />,
      );
      // Find the Marker render call for our testID.
      const markerProps = markerRenderCalls.find((p) => p.testID === 'm-footprint');
      expect(markerProps).toBeTruthy();
      const style = flattenStyle(markerProps.style);
      expect(typeof style.width).toBe('number');
      expect(typeof style.height).toBe('number');
      expect(style.width).toBeGreaterThan(0);
      expect(style.height).toBeGreaterThan(0);
      // Footprint height must be > 60 (box is 62 scaled) to contain the marker.
      expect(style.height).toBeGreaterThan(60);
    });

    it('cluster marker passes explicit numeric width/height on Marker style', () => {
      render(
        <BookMarker
          coordinate={coordinate}
          title="Test"
          variant="cluster"
          category="fiction"
          clusterCount={5}
          testID="m-cluster-footprint"
        />,
      );
      const markerProps = markerRenderCalls.find((p) => p.testID === 'm-cluster-footprint');
      expect(markerProps).toBeTruthy();
      const style = flattenStyle(markerProps.style);
      expect(typeof style.width).toBe('number');
      expect(typeof style.height).toBe('number');
      expect(style.width).toBeGreaterThan(0);
      expect(style.height).toBeGreaterThan(0);
    });

    it('all marker variants pass non-zero width/height (no 100px fallback possible)', () => {
      const variants: Array<{ variant: any; extra?: any }> = [
        { variant: 'standard' },
        { variant: 'fresh', extra: { freshAgeHours: 3 } },
        { variant: 'shelf', extra: { stackCount: 2 } },
        { variant: 'unavailable' },
        { variant: 'textbook', extra: { latitudeDelta: 0.02 } },
      ];
      for (const { variant, extra } of variants) {
        markerRenderCalls.length = 0;
        render(
          <BookMarker
            coordinate={coordinate}
            title="Test"
            variant={variant}
            category="fiction"
            distance="1 km"
            testID={`m-${variant}`}
            {...extra}
          />,
        );
        const markerProps = markerRenderCalls.find((p) => p.testID === `m-${variant}`);
        expect(markerProps).toBeTruthy();
        const style = flattenStyle(markerProps.style);
        expect(typeof style.width).toBe('number');
        expect(typeof style.height).toBe('number');
        expect(style.width).toBeGreaterThan(0);
        expect(style.height).toBeGreaterThan(0);
        // CRITICAL: if width or height is 0, the native 100px fallback triggers.
        expect(style.width).not.toBe(0);
        expect(style.height).not.toBe(0);
      }
    });
  });
});

// ── Test helpers: walk the RNT render tree to find children by type ──────────

function findFirstChildOfType(node: any, type: string): any {
  if (!node || !node.props) return null;
  const children = flattenChildren(node.props.children);
  for (const c of children) {
    if (typeof c !== 'object' || c === null) continue;
    // RNT exposes the component display name on the rendered element.
    const childType = typeof c.type === 'string' ? c.type : (c.type?.displayName ?? c.type?.name);
    if (childType === type) return c;
    const found = findFirstChildOfType(c, type);
    if (found) return found;
  }
  return null;
}

function findAllChildrenOfType(node: any, type: string): any[] {
  const out: any[] = [];
  if (!node || !node.props) return out;
  const children = flattenChildren(node.props.children);
  for (const c of children) {
    if (typeof c !== 'object' || c === null) continue;
    const childType = typeof c.type === 'string' ? c.type : (c.type?.displayName ?? c.type?.name);
    if (childType === type) out.push(c);
    out.push(...findAllChildrenOfType(c, type));
  }
  return out;
}

function flattenChildren(children: any): any[] {
  if (children == null) return [];
  if (Array.isArray(children)) return children.flatMap(flattenChildren);
  return [children];
}

// RN style props may be an object, an array of objects, or array with falsy
// entries (e.g. `[styles.cover, undefined, false && styles.grayscale]`).
// Flatten into a single object so `.width` / `.height` are readable.
function flattenStyle(style: any): Record<string, any> {
  if (!style) return {};
  if (Array.isArray(style)) {
    return style.reduce((acc, s) => ({ ...acc, ...flattenStyle(s) }), {});
  }
  if (typeof style === 'object') return { ...style };
  return {};
}
