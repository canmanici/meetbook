/**
 * RightControls — spec §3.6 floating control stack.
 *
 * Anchored bottom: insets.bottom + sheetPeekHeight + spacing.md (no magic number).
 * Buttons match vision HTML: near-opaque white background (rgba(255,255,255,0.95)),
 * 48×48, borderRadius 16, strong shadow. Dark mode: rgba(33,31,26,0.92).
 *
 * Buttons (bottom-up): recenter (accent green), filter (badge), map-type.
 * Fit-all removed per user request.
 */
import React from 'react';
import { View, TouchableOpacity, StyleSheet, Text, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { spacing, shadows, type ThemeColors } from '@/components/ui/tokens';

interface RightControlsProps {
  onRecenter: () => void;
  onFilter: () => void;
  onCycleMapType: () => void;
  filterCount: number;
  insets: { bottom: number };
  peekHeightPx: number;
  colors: ThemeColors;
  isDark: boolean;
}

export function RightControls({
  onRecenter,
  onFilter,
  onCycleMapType,
  filterCount,
  insets,
  peekHeightPx,
  colors,
  isDark,
}: RightControlsProps) {
  const bottom = insets.bottom + peekHeightPx + spacing.md;
  const btnBg = isDark ? 'rgba(33,31,26,0.92)' : 'rgba(255,255,255,0.95)';
  const iconColor = colors.primary;
  const borderColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0)';

  return (
    <View style={[styles.container, { bottom }]} testID="right-controls">
      {/* Recenter — accent green button (vision: solid #11806B) */}
      <TouchableOpacity onPress={onRecenter} testID="ctrl-recenter" hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <View style={[styles.btn, { backgroundColor: colors.primary, borderColor }]}>
          <Ionicons name="locate" size={22} color="#FFFFFF" />
        </View>
      </TouchableOpacity>

      {/* Filter — badge shows active filter count */}
      <TouchableOpacity onPress={onFilter} testID="ctrl-filter" hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <View style={[styles.btn, { backgroundColor: btnBg, borderColor }]}>
          <Ionicons name="options" size={22} color={iconColor} />
          {filterCount > 0 && (
            <View style={styles.badge} testID="ctrl-filter-badge">
              <Text style={styles.badgeText}>{filterCount}</Text>
            </View>
          )}
        </View>
      </TouchableOpacity>

      {/* Map type — vision uses eye icon */}
      <TouchableOpacity onPress={onCycleMapType} testID="ctrl-maptype" hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <View style={[styles.btn, { backgroundColor: btnBg, borderColor }]}>
          <Ionicons name="eye" size={22} color={iconColor} />
        </View>
      </TouchableOpacity>
    </View>
  );
}

const BTN_SIZE = 48;

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    right: spacing.lg,
    gap: spacing.sm,
    zIndex: 20,
  },
  btn: {
    width: BTN_SIZE,
    height: BTN_SIZE,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    ...shadows.float,
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#F2766B',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
    paddingHorizontal: 3,
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.3, shadowRadius: 2 },
      android: { elevation: 3 },
    }),
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '800',
  },
});

export default RightControls;
