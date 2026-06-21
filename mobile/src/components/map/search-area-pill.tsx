/**
 * SearchAreaPill — spec §3.7 "Bu alanı ara" pill.
 *
 * Appears when the map viewport drifts >20% off the last queried region.
 * Positioned above the bottom sheet peek. Tap → re-query the visible bbox.
 */
import React from 'react';
import { TouchableOpacity, Text, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { spacing, fontSize } from '@/components/ui/tokens';

interface SearchAreaPillProps {
  onPress: () => void;
  /** Pixel height of the sheet peek state — pill sits above it. */
  peekHeightPx: number;
  insetsBottom: number;
  testID?: string;
}

export function SearchAreaPill({
  onPress,
  peekHeightPx,
  insetsBottom,
  testID,
}: SearchAreaPillProps) {
  const bottom = insetsBottom + peekHeightPx + spacing.md + 56; // above right controls

  return (
    <TouchableOpacity
      style={[styles.pill, { bottom }]}
      onPress={onPress}
      activeOpacity={0.8}
      testID={testID ?? 'search-area-pill'}
    >
      <Ionicons name="add-circle" size={18} color="#FFFFFF" />
      <Text style={styles.text}>Bu alanı ara</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  pill: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: '#2A2722',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: 22,
    zIndex: 20,
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8 },
      android: { elevation: 8 },
    }),
  },
  text: {
    color: '#FFFFFF',
    fontSize: fontSize.bodySm,
    fontWeight: '700',
  },
});

export default SearchAreaPill;
