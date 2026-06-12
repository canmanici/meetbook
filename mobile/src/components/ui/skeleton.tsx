import React from 'react';
import {
  View,
  StyleSheet,
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
  if (variant === 'card') {
    return (
      <View style={[styles.cardContainer, style]} testID="skeleton-card">
        <View style={styles.cardCover} testID="skeleton-cover" />
        <View style={styles.cardContent}>
          <View style={[styles.cardTitleLine, { width: '90%' }]} testID="skeleton-title" />
          <View style={[styles.cardMetaLine, { width: '60%' }]} testID="skeleton-author" />
          <View style={styles.cardFooter}>
            <View style={[styles.badge, { width: 60 }]} testID="skeleton-badge" />
            <View style={[styles.cardMetaLine, { width: 40 }]} testID="skeleton-distance" />
          </View>
        </View>
      </View>
    );
  }

  // list-item variant
  return (
    <View style={[styles.listContainer, style]} testID="skeleton-list">
      <View style={styles.listCover} testID="skeleton-cover" />
      <View style={styles.listContent}>
        <View style={[styles.listTitleLine, { width: '80%' }]} testID="skeleton-title" />
        <View style={[styles.listMetaLine, { width: '50%' }]} testID="skeleton-author" />
        <View style={styles.listFooter}>
          <View style={[styles.badge, { width: 50 }]} testID="skeleton-badge" />
          <View style={[styles.listMetaLine, { width: 35 }]} testID="skeleton-distance" />
        </View>
      </View>
    </View>
  );
};

const shimmerBase = {
  backgroundColor: palette.light.textMuted,
  opacity: 0.15,
} as const;

const styles = StyleSheet.create({
  // Card variant (horizontal layout like BookCard)
  cardContainer: {
    flexDirection: 'row',
    backgroundColor: palette.light.surface,
    borderRadius: radius.input,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  cardCover: {
    width: 60,
    height: 80,
    borderRadius: radius.input,
    marginRight: spacing.md,
    ...shimmerBase,
  },
  cardContent: {
    flex: 1,
    justifyContent: 'space-between',
  },
  cardTitleLine: {
    height: fontSize.body,
    borderRadius: radius.input,
    marginBottom: spacing.xs,
    ...shimmerBase,
  },
  cardMetaLine: {
    height: fontSize.bodySm,
    borderRadius: radius.input,
    marginBottom: spacing.sm,
    ...shimmerBase,
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  // List item variant (compact horizontal layout)
  listContainer: {
    flexDirection: 'row',
    backgroundColor: palette.light.surface,
    borderRadius: radius.input,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  listCover: {
    width: 50,
    height: 70,
    borderRadius: radius.input,
    marginRight: spacing.md,
    ...shimmerBase,
  },
  listContent: {
    flex: 1,
    justifyContent: 'space-between',
  },
  listTitleLine: {
    height: fontSize.body,
    borderRadius: radius.input,
    marginBottom: spacing.xs,
    ...shimmerBase,
  },
  listMetaLine: {
    height: fontSize.bodySm,
    borderRadius: radius.input,
    marginBottom: spacing.sm,
    ...shimmerBase,
  },
  listFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  // Shared elements
  badge: {
    height: 20,
    borderRadius: radius.pill,
    ...shimmerBase,
  },
});
