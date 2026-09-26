/**
 * BookMarker — spec §3.4 compliant marker system.
 *
 * Six variants:
 *   standard   — 46×62 cover, 3px category-color ring, distance label above
 *   textbook   — same as standard, no distance label when zoomed out (latitudeDelta > 0.05)
 *   fresh      — coral pulse ring (2s loop) + "Yeni · Xsa" label
 *   shelf      — stacked covers (2 behind) + +N badge (from backend /books/clusters)
 *   unavailable — grayscale + ⊘ overlay, grey ring
 *   cluster    — count bubble, color = dominant category (from supercluster)
 *
 * Category → color map uses the `pastels` token set (spec §3.4).
 * Border: light → #fff, dark → palette.dark.surface (spec §3.4).
 * Selection: scale 1.3× + 6px primary glow ring (spec §3.4).
 */
import React, { useEffect, useRef, useState } from 'react';
import { View, Image, StyleSheet, Text, Platform, ViewStyle, ImageStyle } from 'react-native';
import { Marker } from '@/lib/map-adapter';
import { moderateScale } from 'react-native-size-matters';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withSpring,
  Easing,
  cancelAnimation,
} from 'react-native-reanimated';
import { pastels, palette, type PastelName } from '@/components/ui/tokens';

// ── Types ──────────────────────────────────────────────────────────────────

export type MarkerVariant =
  | 'standard'
  | 'textbook'
  | 'fresh'
  | 'shelf'
  | 'unavailable'
  | 'cluster';

export interface BookMarkerProps {
  coordinate: { latitude: number; longitude: number };
  coverUrl?: string | null;
  thumbnailUrl?: string | null;
  title: string;
  onPress?: () => void;
  variant?: MarkerVariant;
  selected?: boolean;
  /** Category key — drives ring color via the pastels token map. */
  category?: BookCategory;
  /** For shelf markers: number of additional books behind the front cover. */
  stackCount?: number;
  /** For cluster markers: total count + dominant category color. */
  clusterCount?: number;
  /** Distance label text (e.g. "1.2 km"). Hidden for textbook at low zoom. */
  distance?: string;
  /** For fresh markers: age in hours (renders as "Yeni · {n}sa"). */
  freshAgeHours?: number;
  /** Current map latitudeDelta — drives textbook no-distance rule. */
  latitudeDelta?: number;
  /** Dark mode flag — flips border color. */
  isDark?: boolean;
  testID?: string;
}

export type BookCategory =
  | 'fiction'
  | 'non_fiction'
  | 'textbook'
  | 'comics'
  | 'children'
  | 'poetry'
  | 'other';

// ── Category → pastel color map (spec §3.4) ────────────────────────────────

const CATEGORY_PASTEL: Record<BookCategory, PastelName | null> = {
  fiction: 'mint',
  non_fiction: 'sky',
  textbook: 'sky',
  comics: 'butter',
  children: 'blush',
  poetry: 'coral',
  other: null, // → palette.primary
};

export function categoryColor(category: BookCategory, isDark: boolean): string {
  const pastelName = CATEGORY_PASTEL[category];
  if (!pastelName) return palette[isDark ? 'dark' : 'light'].primary;
  return pastels[isDark ? 'dark' : 'light'][pastelName].ink;
}

export function dominantCategoryColor(
  categories: BookCategory[],
  isDark: boolean,
): string {
  if (categories.length === 0) return palette[isDark ? 'dark' : 'light'].primary;
  const counts: Record<string, number> = {};
  for (const c of categories) counts[c] = (counts[c] ?? 0) + 1;
  const dominant = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] as BookCategory;
  return categoryColor(dominant, isDark);
}

// ── Dimensions (spec §3.4: 46×62, 3px ring) ────────────────────────────────

const MARKER_W = moderateScale(46);
const MARKER_H = moderateScale(62);
const RING_W = moderateScale(3);
const SHELF_OFFSET = moderateScale(5);
const SELECT_SCALE = 1.3;
const GLOW_W = 6;

// Cover sits inside `box` which has `padding: RING_W` on all sides.
// CRITICAL: react-native-maps (1.20.1) on Android rasterizes <Marker> children
// to a bitmap. Percentage-based dims (width/height: '100%') on nested <Image>
// DO NOT resolve reliably during that rasterization pass — the Image renders at
// its intrinsic bitmap size (often ~10×10 dp) or 0, frozen by tracksViewChanges.
// Explicit pixel dims are the only reliable fix. See spec bug §3.4 sizing.
// ── Component ──────────────────────────────────────────────────────────────

export function BookMarker({
  coordinate,
  coverUrl,
  thumbnailUrl,
  title,
  onPress,
  variant = 'standard',
  selected = false,
  category = 'fiction',
  stackCount = 0,
  clusterCount = 0,
  distance,
  freshAgeHours,
  latitudeDelta = 0.05,
  isDark = false,
  testID,
}: BookMarkerProps) {
  // tracksViewChanges fix (spec bug #8): reset on URI change, flip false on load.
  const [tracksViewChanges, setTracksViewChanges] = useState(true);
  const tracksTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const markerUri = thumbnailUrl || coverUrl;

  useEffect(() => {
    setTracksViewChanges(true);
    if (tracksTimerRef.current) clearTimeout(tracksTimerRef.current);
    const timer = setTimeout(() => setTracksViewChanges(false), 2000);
    tracksTimerRef.current = timer;
    return () => {
      if (tracksTimerRef.current) clearTimeout(tracksTimerRef.current);
    };
  }, [markerUri]);

  // ── Fresh pulse animation (2s loop) ──────────────────────────────────────
  const pulseScale = useSharedValue(0.5);
  const pulseOpacity = useSharedValue(0.9);

  useEffect(() => {
    if (variant === 'fresh') {
      pulseScale.value = withRepeat(
        withTiming(1.6, { duration: 2000, easing: Easing.out(Easing.ease) }),
        -1,
        false,
      );
      pulseOpacity.value = withRepeat(
        withTiming(0, { duration: 2000, easing: Easing.out(Easing.ease) }),
        -1,
        false,
      );
    } else {
      cancelAnimation(pulseScale);
      cancelAnimation(pulseOpacity);
    }
  }, [variant, pulseScale, pulseOpacity]);

  const pulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulseScale.value }],
    opacity: pulseOpacity.value,
  }));

  // ── Selection spring (scale 1.3×) ────────────────────────────────────────
  const selectScale = useSharedValue(selected ? SELECT_SCALE : 1);

  useEffect(() => {
    selectScale.value = withSpring(selected ? SELECT_SCALE : 1, {
      damping: 15,
      stiffness: 150,
    });
  }, [selected, selectScale]);

  const selectStyle = useAnimatedStyle(() => ({
    transform: [{ scale: selectScale.value }],
  }));

  // ── Colors ────────────────────────────────────────────────────────────────
  const theme = isDark ? 'dark' : 'light';
  const ringColor =
    variant === 'unavailable'
      ? '#8A8378'
      : variant === 'fresh'
        ? pastels[theme].coral.ink
        : categoryColor(category, isDark);
  const borderColor = isDark ? palette.dark.surface : '#FFFFFF';
  const glowColor = palette[theme].primary;

  // ── Label logic ───────────────────────────────────────────────────────────
  const showDistanceLabel =
    !!distance && variant !== 'textbook';
  const showTextbookLabel =
    variant === 'textbook' && !!distance && latitudeDelta <= 0.05;
  const freshLabel = freshAgeHours != null
    ? `Yeni · ${freshAgeHours}sa`
    : 'Yeni';
  const showFreshLabel = variant === 'fresh';

  // ── Cover image ───────────────────────────────────────────────────────────
  const onLoadEnd = () => setTracksViewChanges(false);

  const renderCover = (extraStyle?: ViewStyle) => {
    if (markerUri) {
      return (
        <Image
          source={{ uri: markerUri }}
          style={[styles.cover, extraStyle as ImageStyle | undefined, variant === 'unavailable' && styles.grayscale]}
          resizeMode="cover"
          onLoad={onLoadEnd}
          onError={onLoadEnd}
        />
      );
    }
    return (
      <View style={[styles.cover, styles.placeholder, extraStyle]} onLayout={onLoadEnd}>
        <Text style={styles.placeholderText}>{title.charAt(0).toUpperCase()}</Text>
      </View>
    );
  };

  // ── Cluster variant (count bubble) ────────────────────────────────────────
  if (variant === 'cluster') {
    const clusterColor = ringColor;
    return (
      <Marker
        coordinate={coordinate}
        anchor={{ x: 0.5, y: 0.5 }}
        tracksViewChanges={tracksViewChanges}
        onPress={onPress}
        testID={testID}
      >
        <View style={[styles.clusterBubble, { backgroundColor: clusterColor, borderColor }]} testID={`${testID}-cluster`}>
          <Text style={styles.clusterText}>{clusterCount > 0 ? clusterCount : '·'}</Text>
        </View>
      </Marker>
    );
  }

  // ── Shelf variant (stacked covers + +N badge) ────────────────────────────
  const isShelf = variant === 'shelf';

  return (
    <Marker
      coordinate={coordinate}
      anchor={{ x: 0.5, y: 0.5 }}
      tracksViewChanges={tracksViewChanges}
      onPress={onPress}
      testID={testID}
    >
      <Animated.View style={[styles.wrapper, selectStyle]} testID={`${testID}-wrapper`}>
        {/* Distance / fresh label above marker */}
        {(showDistanceLabel || showTextbookLabel || showFreshLabel) && (
          <View
            style={[
              styles.label,
              showFreshLabel && { backgroundColor: pastels[theme].coral.ink },
            ]}
          >
            <Text style={styles.labelText}>
              {showFreshLabel ? freshLabel : distance}
            </Text>
          </View>
        )}

        {/* Fresh pulse ring */}
        {variant === 'fresh' && (
          <Animated.View
            style={[styles.pulseRing, { borderColor: pastels[theme].coral.ink }, pulseStyle]}
            pointerEvents="none"
          />
        )}

        {/* Selection glow ring */}
        {selected && (
          <View
            style={[styles.glowRing, { borderColor: glowColor }]}
            pointerEvents="none"
          />
        )}

        {/* Shelf stacked covers behind */}
        {isShelf && (
          <>
            <View style={[styles.shelfBack2, { borderColor }]} />
            <View style={[styles.shelfBack1, { borderColor }]}>
              {markerUri && (
                <Image
                  source={{ uri: markerUri }}
                  style={styles.shelfBackImage}
                  resizeMode="cover"
                />
              )}
            </View>
          </>
        )}

        {/* Main cover box with category-color ring */}
        <View style={[styles.box, { borderColor, borderWidth: RING_W }]}>
          <View style={[styles.ring, { borderColor: ringColor, borderWidth: RING_W }]} />
          {renderCover()}
          {variant === 'unavailable' && (
            <View style={styles.unavailableOverlay}>
              <Text style={styles.unavailableIcon}>⊘</Text>
            </View>
          )}
        </View>

        {/* Shelf +N badge */}
        {isShelf && stackCount > 0 && (
          <View style={[styles.stackBadge, { backgroundColor: palette[theme].primary, borderColor }]}>
            <Text style={styles.stackBadgeText}>+{stackCount}</Text>
          </View>
        )}
      </Animated.View>
    </Marker>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  wrapper: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    backgroundColor: '#2A2722',
    paddingHorizontal: moderateScale(7),
    paddingVertical: moderateScale(3),
    borderRadius: moderateScale(10),
    marginBottom: moderateScale(4),
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.3, shadowRadius: 3 },
      android: { elevation: 3 },
    }),
  },
  labelText: {
    color: '#FFFFFF',
    fontSize: moderateScale(10),
    fontWeight: '700',
  },
  pulseRing: {
    position: 'absolute',
    width: MARKER_W + moderateScale(24),
    height: MARKER_H + moderateScale(24),
    borderRadius: moderateScale(35),
    borderWidth: 2,
  },
  glowRing: {
    position: 'absolute',
    width: MARKER_W + GLOW_W * 2,
    height: MARKER_H + GLOW_W * 2,
    borderRadius: moderateScale(16) + GLOW_W,
    borderWidth: GLOW_W,
  },
  box: {
    width: MARKER_W,
    height: MARKER_H,
    borderRadius: moderateScale(12),
    backgroundColor: '#FFFFFF',
    padding: RING_W,
    overflow: 'hidden',
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.35, shadowRadius: 5 },
      android: { elevation: 6 },
    }),
  },
  ring: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: moderateScale(12),
  },
  cover: {
    width: '100%',
    height: '100%',
    borderRadius: moderateScale(9),
    backgroundColor: '#333333',
  },
  grayscale: {
    opacity: 0.4,
  },
  placeholder: {
    backgroundColor: '#333333',
    justifyContent: 'center',
    alignItems: 'center',
  },
  placeholderText: {
    color: '#FFFFFF',
    fontSize: moderateScale(18),
    fontWeight: '800',
  },
  unavailableOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  unavailableIcon: {
    fontSize: moderateScale(24),
    color: '#8A8378',
    fontWeight: '900',
  },
  shelfBack1: {
    position: 'absolute',
    top: SHELF_OFFSET,
    left: SHELF_OFFSET,
    width: MARKER_W,
    height: MARKER_H,
    borderRadius: moderateScale(12),
    borderWidth: RING_W,
    backgroundColor: '#F4EEE1',
    overflow: 'hidden',
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 4 },
      android: { elevation: 4 },
    }),
  },
  shelfBack2: {
    position: 'absolute',
    top: SHELF_OFFSET * 1.5,
    left: -SHELF_OFFSET,
    width: MARKER_W,
    height: MARKER_H,
    borderRadius: moderateScale(12),
    borderWidth: RING_W,
    backgroundColor: '#ECE4D6',
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.15, shadowRadius: 3 },
      android: { elevation: 2 },
    }),
  },
  shelfBackImage: {
    width: '100%',
    height: '100%',
    borderRadius: moderateScale(9),
  },
  stackBadge: {
    position: 'absolute',
    top: -moderateScale(6),
    right: -moderateScale(6),
    minWidth: moderateScale(22),
    height: moderateScale(22),
    borderRadius: moderateScale(11),
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: moderateScale(4),
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.3, shadowRadius: 2 },
      android: { elevation: 4 },
    }),
  },
  stackBadgeText: {
    color: '#FFFFFF',
    fontSize: moderateScale(11),
    fontWeight: '800',
  },
  clusterBubble: {
    width: moderateScale(44),
    height: moderateScale(44),
    borderRadius: moderateScale(22),
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.4, shadowRadius: 6 },
      android: { elevation: 8 },
    }),
  },
  clusterText: {
    color: '#FFFFFF',
    fontSize: moderateScale(16),
    fontWeight: '800',
  },
});

export default BookMarker;
