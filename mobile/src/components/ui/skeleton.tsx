import React from 'react';
import {
  View,
  StyleSheet,
  useColorScheme,
  ViewStyle,
} from 'react-native';
import { palette, spacing, radius, fontSize } from './tokens';

export type SkeletonVariant = 'card' | 'list-item';

export interface SkeletonProps {
  /**
   * Visual style variant
   * - 'card': Full card skeleton (for grid layouts)
   * - 'list-item': Horizontal list item skeleton (for list views)
   */
  variant?: SkeletonVariant;

  /**
   * Optional custom container style
   */
  style?: ViewStyle;
}

/**
 * Skeleton component — loading placeholder for content before it loads.
 *
 * Features:
 * - Two variants: card (for grid layouts) and list-item (for list views)
 * - Animated shimmer effect via opacity
 * - Matches real component dimensions and spacing
 * - Uses design tokens for consistency
 *
 * Usage:
 * ```tsx
 * // Card skeleton for book grid
 * <Skeleton variant="card" />
 *
 * // List item skeleton for search results
 * <Skeleton variant="list-item" />
 * ```
 */
export const Skeleton: React.FC<SkeletonProps> = ({
  variant = 'list-item',
  style,
}) => {
  const scheme = useColorScheme();
  const colors = palette[scheme === 'dark' ? 'dark' : 'light'];
  const shimmer = { backgroundColor: colors.textMuted, opacity: 0.15 } as const;

  if (variant === 'card') {
    return (
      <View style={[{ flexDirection: 'row', backgroundColor: colors.surface, borderRadius: radius.input, padding: spacing.md, marginBottom: spacing.sm }, style]} testID="skeleton-card">
        <View style={{ width: 60, height: 80, borderRadius: radius.input, marginRight: spacing.md, ...shimmer }} testID="skeleton-cover" />
        <View style={{ flex: 1, justifyContent: 'space-between' }}>
          <View style={{ height: fontSize.body, borderRadius: radius.input, marginBottom: spacing.xs, width: '90%', ...shimmer }} testID="skeleton-title" />
          <View style={{ height: fontSize.bodySm, borderRadius: radius.input, marginBottom: spacing.sm, width: '60%', ...shimmer }} testID="skeleton-author" />
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ height: 20, borderRadius: radius.pill, width: 60, ...shimmer }} testID="skeleton-badge" />
            <View style={{ height: fontSize.bodySm, borderRadius: radius.input, width: 40, ...shimmer }} testID="skeleton-distance" />
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={[{ flexDirection: 'row', backgroundColor: colors.surface, borderRadius: radius.input, padding: spacing.md, marginBottom: spacing.sm }, style]} testID="skeleton-list">
      <View style={{ width: 50, height: 70, borderRadius: radius.input, marginRight: spacing.md, ...shimmer }} testID="skeleton-cover" />
      <View style={{ flex: 1, justifyContent: 'space-between' }}>
        <View style={{ height: fontSize.body, borderRadius: radius.input, marginBottom: spacing.xs, width: '80%', ...shimmer }} testID="skeleton-title" />
        <View style={{ height: fontSize.bodySm, borderRadius: radius.input, marginBottom: spacing.sm, width: '50%', ...shimmer }} testID="skeleton-author" />
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ height: 20, borderRadius: radius.pill, width: 50, ...shimmer }} testID="skeleton-badge" />
          <View style={{ height: fontSize.bodySm, borderRadius: radius.input, width: 35, ...shimmer }} testID="skeleton-distance" />
        </View>
      </View>
    </View>
  );
};
