/**
 * BookMarker — restored to old 80×220 book-shaped style.
 *
 * Simple cover image with white border, shadow, and Callout tooltip.
 * Children rendering on both platforms (no Android icon prop — causes
 * "error while updating property icon" when tracksViewChanges is true).
 * Image error fallback shows first letter of title.
 */
import React, { useEffect, useRef, useState } from 'react';
import { View, Image, StyleSheet, Text, Platform } from 'react-native';
import { Marker, Callout } from 'react-native-maps';
import { moderateScale } from 'react-native-size-matters';

// ── Types ──────────────────────────────────────────────────────────────────

export type BookCategory =
  | 'fiction'
  | 'non_fiction'
  | 'textbook'
  | 'comics'
  | 'children'
  | 'poetry'
  | 'other';

export interface BookMarkerProps {
  coordinate: { latitude: number; longitude: number };
  coverUrl?: string | null;
  thumbnailUrl?: string | null;
  title: string;
  onPress?: () => void;
  variant?: 'standard' | 'shelf' | 'cluster' | 'fresh' | 'unavailable' | 'textbook';
  selected?: boolean;
  category?: BookCategory;
  stackCount?: number;
  clusterCount?: number;
  distance?: string;
  freshAgeHours?: number;
  latitudeDelta?: number;
  isDark?: boolean;
  testID?: string;
}

// ── Dimensions (old style: 80×220) ────────────────────────────────────────

const MARKER_WIDTH = moderateScale(80);
const MARKER_HEIGHT = moderateScale(220);

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
  clusterCount = 0,
  testID,
}: BookMarkerProps) {
  const [tracksViewChanges, setTracksViewChanges] = useState(true);
  const [imageError, setImageError] = useState(false);
  const tracksTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Prefer thumbnail (pre-sized), fall back to full cover
  const markerUri = thumbnailUrl || coverUrl;

  useEffect(() => {
    setTracksViewChanges(true);
    setImageError(false);
    if (tracksTimerRef.current) clearTimeout(tracksTimerRef.current);
    const timer = setTimeout(() => setTracksViewChanges(false), 5000);
    tracksTimerRef.current = timer;
    return () => {
      if (tracksTimerRef.current) clearTimeout(tracksTimerRef.current);
    };
  }, [markerUri]);

  // ── Cluster variant (count bubble) ────────────────────────────────────────
  if (variant === 'cluster') {
    return (
      <Marker
        coordinate={coordinate}
        anchor={{ x: 0.5, y: 0.5 }}
        tracksViewChanges={tracksViewChanges}
        onPress={onPress}
        testID={testID}
      >
        <View style={styles.clusterBubble}>
          <Text style={styles.clusterText}>{clusterCount > 0 ? clusterCount : '·'}</Text>
        </View>
      </Marker>
    );
  }

  return (
    <Marker
      coordinate={coordinate}
      anchor={{ x: 0.5, y: 0.5 }}
      tracksViewChanges={tracksViewChanges}
      onPress={onPress}
      testID={testID}
    >
      {/* Render children on both iOS and Android — no icon prop */}
      <View style={[styles.wrapper, selected && styles.selected]}>
        <View style={styles.box}>
          {markerUri && !imageError ? (
            <Image
              source={{ uri: markerUri }}
              style={styles.cover}
              resizeMode="cover"
              onLoad={() => setTracksViewChanges(false)}
              onError={() => {
                setImageError(true);
                setTracksViewChanges(false);
              }}
            />
          ) : (
            <View style={[styles.cover, styles.placeholder]}>
              <Text style={styles.placeholderText}>
                {title.charAt(0).toUpperCase()}
              </Text>
            </View>
          )}
        </View>
      </View>

      {/* Callout tooltip — shows on tap */}
      <Callout tooltip onPress={onPress}>
        <View style={styles.calloutContainer}>
          <View style={styles.calloutBubble}>
            <Text style={styles.calloutText} numberOfLines={1} ellipsizeMode="tail">
              {title || 'Untitled'}
            </Text>
          </View>
          <View style={styles.calloutArrow} />
        </View>
      </Callout>
    </Marker>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  wrapper: {
    alignItems: 'center',
  },
  selected: {
    // glow effect when selected
  },
  box: {
    width: MARKER_WIDTH,
    height: MARKER_HEIGHT,
    borderRadius: moderateScale(16),
    backgroundColor: '#FFF',
    padding: moderateScale(3),
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.3,
        shadowRadius: 4,
      },
      android: { elevation: 5 },
    }),
  },
  cover: {
    flex: 1,
    width: '100%',
    height: '100%',
    borderRadius: moderateScale(13),
    backgroundColor: '#000',
  },
  placeholder: {
    backgroundColor: '#333333',
    justifyContent: 'center',
    alignItems: 'center',
  },
  placeholderText: {
    color: '#FFFFFF',
    fontSize: moderateScale(24),
    fontWeight: '800',
  },
  // ── Callout ──────────────────────────────────────────────────────────────
  calloutContainer: {
    alignItems: 'center',
    marginTop: -moderateScale(8),
  },
  calloutBubble: {
    backgroundColor: '#2A2722',
    paddingHorizontal: moderateScale(12),
    paddingVertical: moderateScale(6),
    borderRadius: moderateScale(10),
    maxWidth: moderateScale(180),
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.3, shadowRadius: 3 },
      android: { elevation: 3 },
    }),
  },
  calloutText: {
    color: '#FFFFFF',
    fontSize: moderateScale(12),
    fontWeight: '600',
    textAlign: 'center',
  },
  calloutArrow: {
    width: 0,
    height: 0,
    borderLeftWidth: moderateScale(6),
    borderRightWidth: moderateScale(6),
    borderTopWidth: moderateScale(6),
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: '#2A2722',
  },
  // ── Cluster ──────────────────────────────────────────────────────────────
  clusterBubble: {
    width: moderateScale(44),
    height: moderateScale(44),
    borderRadius: moderateScale(22),
    backgroundColor: '#2A9D8F',
    borderWidth: 3,
    borderColor: '#FFFFFF',
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

// ── Helper exports (kept for compatibility) ────────────────────────────────

const CATEGORY_PASTEL: Record<BookCategory, string> = {
  fiction: '#A8D5BA',
  non_fiction: '#B8D4E3',
  textbook: '#B8D4E3',
  comics: '#F5E6A3',
  children: '#F5C6C6',
  poetry: '#F5B8A3',
  other: '#D4D4D4',
};

export function categoryColor(category: BookCategory, isDark: boolean): string {
  return CATEGORY_PASTEL[category] ?? (isDark ? '#555' : '#CCC');
}

export function dominantCategoryColor(categories: BookCategory[], isDark: boolean): string {
  if (categories.length === 0) return isDark ? '#555' : '#CCC';
  const counts: Record<string, number> = {};
  for (const c of categories) counts[c] = (counts[c] ?? 0) + 1;
  const dominant = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] as BookCategory;
  return categoryColor(dominant, isDark);
}

export type MarkerVariant = 'standard' | 'shelf' | 'cluster' | 'fresh' | 'unavailable' | 'textbook';

export default BookMarker;
